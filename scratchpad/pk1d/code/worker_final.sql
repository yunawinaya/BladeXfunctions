SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.attempt_count,
       j.lease_owner,
       j.error_code,
       j.error_message,
       j.picking_id,
       -- only an open force complete has edits to kick; they are read through the open-job states (an index on job_status)
       CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.operation')) = 'FORCE_COMPLETE'
             AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING')
            THEN (SELECT GROUP_CONCAT(CAST(e.id AS CHAR) ORDER BY e.id)
                    FROM gd_async_job e
                   WHERE e.tenant_id = j.tenant_id
                     AND e.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'HELD')
                     AND (e.job_status <> 'HELD' OR e.next_attempt_at <= NOW(3))
                     AND (e.lease_expires_at IS NULL OR e.lease_expires_at <= NOW(3))
                     AND e.is_deleted = 0 AND e.command = 'EDIT_GD' AND e.causation_id = 'PICKING_FC'
                     AND CAST(JSON_UNQUOTE(JSON_EXTRACT(e.request_payload, '$.causation_job_id')) AS UNSIGNED) = j.id)
       END AS kick
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_PWguard.data.tenantId}}'
   AND j.id IN ({{node:code_node_PWplan.data.jobIdsSql}})
