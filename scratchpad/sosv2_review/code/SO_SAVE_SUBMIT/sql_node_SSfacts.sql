SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(so.id AS CHAR) AS so_id,
       so.so_no,
       so.so_status,
       COALESCE(so.is_processing, 0) AS is_processing,
       (SELECT p.step_name FROM gd_publish_step p
         WHERE p.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND p.job_id = 'SOS|{{node:code_node_SSguard.data.soId}}' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS last_lock,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(o.id AS CHAR), 'job_status', o.job_status, 'progress_percent', o.progress_percent, 'progress_message', o.progress_message,
                                             'error_code', o.error_code, 'error_message', o.error_message)) AS CHAR)
          FROM gd_async_job o
         WHERE o.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND o.is_deleted = 0 AND o.command = 'SAVE_SO' AND o.correlation_id = 'SO|{{node:code_node_SSguard.data.soId}}' AND o.job_status IN ('QUEUED', 'PREPARING', 'CASCADE_PREPARING', 'AWAITING_CONFIRMATION', 'READY_TO_COMMIT', 'COMMITTING_SO', 'RELEASING', 'AFTER', 'REQUIRES_REVIEW')) AS open_jobs,
       (SELECT CAST(JSON_OBJECT('id', CAST(d.id AS CHAR), 'job_status', d.job_status, 'progress_percent', d.progress_percent, 'progress_message', d.progress_message, 'error_code', d.error_code, 'error_message', d.error_message, 'error_details', d.error_details, 'confirmation_token', d.confirmation_token, 'request_payload', d.request_payload, 'row_version', d.row_version, 'correlation_id', d.correlation_id, 'idempotency_key', d.idempotency_key) AS CHAR)
          FROM gd_async_job d
         WHERE d.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND d.is_deleted = 0 AND d.command = 'SAVE_SO'
           AND '{{node:code_node_SSguard.data.payloadHash}}' <> '' AND d.payload_hash = '{{node:code_node_SSguard.data.payloadHash}}'
           AND '{{node:code_node_SSguard.data.uid}}' <> '' AND CAST(d.create_user AS CHAR) = '{{node:code_node_SSguard.data.uid}}'
           AND (({{node:code_node_SSguard.data.soId}} <> 0 AND d.correlation_id = 'SO|{{node:code_node_SSguard.data.soId}}') OR ({{node:code_node_SSguard.data.soId}} = 0 AND d.correlation_id LIKE 'SOA|%'))
           AND (d.job_status IN ('QUEUED', 'PREPARING', 'CASCADE_PREPARING', 'AWAITING_CONFIRMATION', 'READY_TO_COMMIT', 'COMMITTING_SO', 'RELEASING', 'AFTER', 'REQUIRES_REVIEW') OR (d.job_status = 'COMPLETED' AND d.update_time > CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') - INTERVAL 60 SECOND))
         ORDER BY d.id DESC LIMIT 1) AS same_job,
       (SELECT COUNT(*) FROM goods_delivery g
         WHERE {{node:code_node_SSguard.data.soId}} <> 0 AND g.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND g.is_deleted = 0 AND g.gd_status = 'Processing' AND (JSON_CONTAINS(g.so_id, '{{node:code_node_SSguard.data.soId}}') OR JSON_CONTAINS(g.so_id, JSON_QUOTE('{{node:code_node_SSguard.data.soId}}')))) AS gd_processing,
       (SELECT COUNT(*) FROM gd_async_job c
         WHERE {{node:code_node_SSguard.data.soId}} <> 0 AND c.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND c.is_deleted = 0 AND c.command = 'CREATE_GD_FROM_FORM' AND c.job_status IN ('QUEUED', 'VALIDATING', 'CALCULATING', 'AWAITING_CONFIRMATION', 'READY_TO_COMMIT', 'COMMITTING_GD', 'RECONCILING_GD', 'REQUIRES_REVIEW')
           AND c.source_so_ids LIKE '%"{{node:code_node_SSguard.data.soId}}"%') AS gd_create_jobs,
       (SELECT GROUP_CONCAT(g.delivery_no ORDER BY g.id SEPARATOR ',') FROM goods_delivery g
         WHERE {{node:code_node_SSguard.data.soId}} <> 0 AND g.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND g.is_deleted = 0 AND g.gd_status = 'Draft' AND (JSON_CONTAINS(g.so_id, '{{node:code_node_SSguard.data.soId}}') OR JSON_CONTAINS(g.so_id, JSON_QUOTE('{{node:code_node_SSguard.data.soId}}')))) AS draft_gd_nos,
       (SELECT GROUP_CONCAT(i.sales_invoice_no ORDER BY i.id SEPARATOR ',') FROM sales_invoice i
         WHERE {{node:code_node_SSguard.data.soId}} <> 0 AND i.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND i.is_deleted = 0 AND i.si_status = 'Draft' AND (JSON_CONTAINS(i.so_id, '{{node:code_node_SSguard.data.soId}}') OR JSON_CONTAINS(i.so_id, JSON_QUOTE('{{node:code_node_SSguard.data.soId}}')))) AS draft_si_nos,
       (SELECT COUNT(*) FROM picking_plan pp
         WHERE {{node:code_node_SSguard.data.soId}} <> 0 AND pp.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND pp.is_deleted = 0 AND pp.to_status = 'Created' AND (JSON_CONTAINS(pp.so_id, '{{node:code_node_SSguard.data.soId}}') OR JSON_CONTAINS(pp.so_id, JSON_QUOTE('{{node:code_node_SSguard.data.soId}}')))) AS live_pp,
       (SELECT CAST(JSON_OBJECT('id', CAST(x.id AS CHAR), 'job_status', x.job_status, 'progress_percent', x.progress_percent, 'progress_message', x.progress_message, 'error_code', x.error_code, 'error_message', x.error_message, 'error_details', x.error_details, 'confirmation_token', x.confirmation_token, 'request_payload', x.request_payload, 'row_version', x.row_version, 'correlation_id', x.correlation_id, 'idempotency_key', x.idempotency_key,
                    'lock_ref', (SELECT p.result_ref FROM gd_publish_step p
                                  WHERE p.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND p.is_deleted = 0 AND p.step_name LIKE 'LOCK|%'
                                    AND p.job_id = (CONCAT('SOS|', SUBSTRING(x.correlation_id, 4)) COLLATE utf8mb4_general_ci) ORDER BY p.id DESC LIMIT 1)) AS CHAR)
          FROM gd_async_job x
         WHERE x.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND x.is_deleted = 0 AND x.command = 'SAVE_SO'
           AND (x.id = {{node:code_node_SSguard.data.jobIdSql}} OR ({{node:code_node_SSguard.data.jobIdSql}} = 0 AND {{node:code_node_SSguard.data.soId}} <> 0 AND x.correlation_id = 'SO|{{node:code_node_SSguard.data.soId}}'))
         ORDER BY x.id DESC LIMIT 1) AS the_job
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN sales_order so
    ON so.tenant_id = '{{node:code_node_SSguard.data.tenantId}}'
   AND so.id = {{node:code_node_SSguard.data.soId}}
   AND so.is_deleted = 0