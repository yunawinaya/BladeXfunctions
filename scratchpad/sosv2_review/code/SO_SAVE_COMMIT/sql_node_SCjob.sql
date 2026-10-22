SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       j.row_version,
       j.prepared_payload,
       j.organization_id,
       j.correlation_id,
       j.idempotency_key,
       CAST(so.id AS CHAR) AS so_id,
       COALESCE(so.is_processing, 0) AS is_processing,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '{{node:code_node_SCguard.data.tenantId}}' AND p.is_deleted = 0 AND p.step_name LIKE 'LOCK|%'
           AND p.job_id = (CONCAT('SOS|', CAST(so.id AS CHAR)) COLLATE utf8mb4_general_ci) ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('step', d.step_name, 'ref', d.result_ref)) AS CHAR) FROM gd_publish_step d
         WHERE d.tenant_id = '{{node:code_node_SCguard.data.tenantId}}' AND d.is_deleted = 0 AND d.step_status = 'DONE'
           AND d.job_id = (CONCAT('SOJ|', CAST(j.id AS CHAR)) COLLATE utf8mb4_general_ci)) AS done_steps
  FROM (SELECT 1 AS one) x
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND j.id = {{node:code_node_SCguard.data.jobIdSql}}
   AND j.command = 'SAVE_SO'
   AND j.is_deleted = 0
  LEFT JOIN sales_order so
    ON so.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND so.is_deleted = 0
   AND j.correlation_id LIKE 'SO|%'
   AND so.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)