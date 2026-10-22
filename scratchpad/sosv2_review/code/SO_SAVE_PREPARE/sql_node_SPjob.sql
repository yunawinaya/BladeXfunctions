SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       j.row_version,
       j.request_payload,
       j.organization_id,
       j.correlation_id,
       j.idempotency_key,
       j.prepared_payload,
       CAST(so.id AS CHAR) AS so_id,
       so.so_status,
       so.so_no,
       COALESCE(so.is_processing, 0) AS is_processing,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '{{node:code_node_SPguard.data.tenantId}}' AND p.is_deleted = 0 AND p.step_name LIKE 'LOCK|%'
           AND p.job_id = (CONCAT('SOS|', CAST(so.id AS CHAR)) COLLATE utf8mb4_general_ci) ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       (SELECT COUNT(*) FROM gd_publish_step r
         WHERE r.tenant_id = '{{node:code_node_SPguard.data.tenantId}}' AND r.is_deleted = 0 AND r.step_status = 'PART' AND r.step_name LIKE 'R|%'
           AND r.job_id = (CONCAT('SOR|', JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.nonce'))) COLLATE utf8mb4_general_ci)) AS part_rows
  FROM (SELECT 1 AS one) x
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '{{node:code_node_SPguard.data.tenantId}}'
   AND j.id = {{node:code_node_SPguard.data.jobIdSql}}
   AND j.command = 'SAVE_SO'
   AND j.is_deleted = 0
  LEFT JOIN sales_order so
    ON so.tenant_id = '{{node:code_node_SPguard.data.tenantId}}'
   AND so.is_deleted = 0
   AND j.correlation_id LIKE 'SO|%'
   AND so.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED)