SELECT id,
       to_status,
       COALESCE(is_processing, 0) AS is_processing,
       TIMESTAMPDIFF(
           SECOND,
           update_time,
           CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
       ) AS lock_age_sec,
       (SELECT CONCAT(CAST(j.id AS CHAR), '|', j.job_status)
          FROM gd_async_job j
         WHERE j.tenant_id = t.tenant_id
           AND j.command = 'CONFIRM_PICKING'
           AND j.picking_id = '{{node:code_node_hjAwTKzF.data.lockId}}'
           AND j.is_deleted = 0
           AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING', 'REQUIRES_REVIEW')
         ORDER BY j.id DESC
         LIMIT 1) AS open_job
FROM transfer_order t
WHERE id = '{{node:code_node_hjAwTKzF.data.lockId}}'
  AND is_deleted = 0
LIMIT 1
