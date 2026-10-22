SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       j.row_version,
       j.attempt_count,
       DATE_FORMAT(j.next_attempt_at, '%Y-%m-%d %H:%i:%s') AS next_attempt_at,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       j.cancel_requested,
       j.progress_message,
       j.prepared_payload,
       j.request_payload,
       j.organization_id,
       j.correlation_id,
       (SELECT COUNT(*) FROM gd_publish_step c
         WHERE c.tenant_id = '{{node:code_node_SWguard.data.tenantId}}' AND c.is_deleted = 0
           AND c.job_id = (CONCAT('SOW|', CAST(j.id AS CHAR)) COLLATE utf8mb4_general_ci)
           AND c.step_name = (CONCAT('W0_CLAIM_', j.row_version) COLLATE utf8mb4_general_ci)) AS claim_taken
  FROM (SELECT 1 AS one) x
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '{{node:code_node_SWguard.data.tenantId}}'
   AND j.id = {{node:code_node_SWguard.data.jobIdSql}}
   AND j.command = 'SAVE_SO'
   AND j.is_deleted = 0