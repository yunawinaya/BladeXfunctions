SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id,
       j.command,
       j.is_deleted,
       j.organization_id,
       j.picking_id,
       j.job_status,
       j.row_version,
       j.attempt_count,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       (j.lease_expires_at > n.t) AS lease_live,
       j.progress_percent,
       j.progress_message,
       IF(JSON_VALID(j.request_payload), JSON_UNQUOTE(JSON_EXTRACT(j.request_payload, '$.operation')), NULL) AS operation,
       IF(JSON_VALID(j.prepared_payload), CAST(JSON_EXTRACT(j.prepared_payload, '$.fc') AS CHAR), NULL) AS fc,
       IF(JSON_VALID(j.prepared_payload), JSON_UNQUOTE(JSON_EXTRACT(j.prepared_payload, '$.picking_no')), NULL) AS picking_no,
       IF(JSON_VALID(j.prepared_payload), JSON_UNQUOTE(JSON_EXTRACT(j.prepared_payload, '$.snapshot.to_status')), NULL) AS snap_to_status,
       IF(JSON_VALID(j.prepared_payload), CAST(JSON_EXTRACT(j.prepared_payload, '$.snapshot.gds') AS CHAR), NULL) AS snap_gds,
       IF(JSON_VALID(j.prepared_payload), CAST(JSON_EXTRACT(j.prepared_payload, '$.gd_ids_all') AS CHAR), NULL) AS gd_ids_all,
       (SELECT GROUP_CONCAT(s.step_name ORDER BY s.step_name)
          FROM gd_publish_step s
         WHERE s.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
           AND s.job_id = '{{node:code_node_DRguard.data.jobId}}'
           AND s.is_deleted = 0
           AND s.step_name IN ('FC_F0', 'FC_HOLD', 'FC_GDS', 'FC_ABORT', 'FC_REVIEW')) AS fc_steps
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
   AND j.id = {{node:code_node_DRguard.data.jobId}}
