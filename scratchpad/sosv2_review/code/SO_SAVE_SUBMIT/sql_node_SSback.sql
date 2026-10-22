SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       COALESCE(so.is_processing, 0) AS is_processing,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND p.job_id = 'SOS|{{node:code_node_SSguard.data.soId}}' AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) AS lock_ref,
       ((SELECT COUNT(*) FROM goods_delivery g
          WHERE {{node:code_node_SSguard.data.soId}} <> 0 AND g.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND g.is_deleted = 0 AND g.gd_status = 'Processing' AND (JSON_CONTAINS(g.so_id, '{{node:code_node_SSguard.data.soId}}') OR JSON_CONTAINS(g.so_id, JSON_QUOTE('{{node:code_node_SSguard.data.soId}}'))))
        + (SELECT COUNT(*) FROM gd_async_job c
            WHERE {{node:code_node_SSguard.data.soId}} <> 0 AND c.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND c.is_deleted = 0 AND c.command = 'CREATE_GD_FROM_FORM' AND c.job_status IN ('QUEUED', 'VALIDATING', 'CALCULATING', 'AWAITING_CONFIRMATION', 'READY_TO_COMMIT', 'COMMITTING_GD', 'RECONCILING_GD', 'REQUIRES_REVIEW')
              AND c.source_so_ids LIKE '%"{{node:code_node_SSguard.data.soId}}"%')
        + (SELECT COUNT(*) FROM gd_async_job o
            WHERE {{node:code_node_SSguard.data.soId}} <> 0 AND o.tenant_id = '{{node:code_node_SSguard.data.tenantId}}' AND o.is_deleted = 0 AND o.command = 'SAVE_SO' AND o.correlation_id = 'SO|{{node:code_node_SSguard.data.soId}}'
              AND o.job_status IN ('QUEUED', 'PREPARING', 'CASCADE_PREPARING', 'AWAITING_CONFIRMATION', 'READY_TO_COMMIT', 'COMMITTING_SO', 'RELEASING', 'AFTER', 'REQUIRES_REVIEW') AND o.id <> COALESCE(j.id, 0))) AS racers
  FROM (SELECT 1 AS one) x
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '{{node:code_node_SSguard.data.tenantId}}'
   AND j.organization_id = '{{node:code_node_SSguard.data.organizationId}}'
   AND j.idempotency_key = '{{node:code_node_SSpost.data.idemKey}}'
   AND j.is_deleted = 0
  LEFT JOIN sales_order so
    ON so.tenant_id = '{{node:code_node_SSguard.data.tenantId}}'
   AND so.id = {{node:code_node_SSguard.data.soId}}
   AND so.is_deleted = 0