SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.row_version,
       j.lease_owner,
       (j.lease_expires_at > n.t) AS lease_live,
       j.progress_percent,
       CAST((SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(e.id AS CHAR), 'status', e.job_status,
                                              'fcd', JSON_UNQUOTE(JSON_EXTRACT(e.request_payload, '$.fcd_ref')),
                                              'gd_id', JSON_UNQUOTE(JSON_EXTRACT(e.request_payload, '$.gd_id')),
                                              'due', (e.next_attempt_at IS NULL OR e.next_attempt_at <= n.t),
                                              'live', (e.lease_expires_at IS NOT NULL AND e.lease_expires_at > n.t),
                                              'code', e.error_code,
                                              'msg', e.error_message,
                                              'queued', DATE_FORMAT(e.queued_at, '%Y-%m-%d %H:%i:%s'),
                                              'finished', DATE_FORMAT(e.finished_at, '%Y-%m-%d %H:%i:%s')))
               FROM gd_async_job e
              WHERE e.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
                AND e.organization_id = '{{node:code_node_DRentry.data.organizationId}}'
                AND ({{node:code_node_DRentry.data.edLikeSql}})
                AND e.is_deleted = 0
                AND e.command = 'EDIT_GD'
                AND e.causation_id = 'PICKING_FC'
                AND CAST(JSON_UNQUOTE(JSON_EXTRACT(e.request_payload, '$.causation_job_id')) AS UNSIGNED) = j.id) AS CHAR) AS edits,
       CAST((SELECT JSON_ARRAYAGG(JSON_OBJECT('name', s.step_name, 'ref', s.result_ref))
               FROM gd_publish_step s
              WHERE s.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
                AND s.job_id = '{{node:code_node_DRguard.data.jobId}}'
                AND s.is_deleted = 0
                AND s.step_name IN ('FC_F0', 'FC_HOLD', 'FC_GDS', 'FC_ABORT', 'FC_REVIEW')) AS CHAR) AS steps
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
   AND j.id = {{node:code_node_DRguard.data.jobId}}
