SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.progress_message,
       j.progress_percent,
       j.error_code,
       j.error_message,
       JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.operation')) AS operation,
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
       END AS kick,
       -- stage 1e: the deliveries this confirm handed to GD Complete V2 (its P7|<gd> steps); the screen starts each QUEUED job
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('gd_id', SUBSTRING(p.step_name, 4), 'gd_no', IFNULL(g.delivery_no, ''), 'status', p.step_status,
                                             'job_id', IFNULL(p.result_ref, ''), 'code', IFNULL(p.error_code, ''), 'message', IFNULL(p.error_message, ''))) AS CHAR)
          FROM gd_publish_step p
          LEFT JOIN goods_delivery g ON g.id = CAST(SUBSTRING(p.step_name, 4) AS UNSIGNED) AND g.tenant_id = p.tenant_id AND g.is_deleted = 0
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci
           AND p.step_name LIKE 'P7|%' AND p.is_deleted = 0) AS gd_complete
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
   AND j.organization_id = '{{node:code_node_PSguard.data.organizationId}}'
   AND j.command = 'CONFIRM_PICKING'
   AND j.picking_id = '{{node:code_node_PSguard.data.pickingId}}'
   AND j.is_deleted = 0
 ORDER BY j.id DESC
 LIMIT 1
