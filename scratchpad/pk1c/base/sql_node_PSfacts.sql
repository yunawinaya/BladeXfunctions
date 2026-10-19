SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(t.id AS CHAR) AS id,
       t.to_id,
       t.to_status,
       t.is_deleted,
       t.organization_id,
       CAST(t.plant_id AS CHAR) AS plant_id,
       COALESCE(t.is_processing, 0) AS is_processing,
       COALESCE(t.is_loading_bay, 0) AS is_loading_bay,
       TIMESTAMPDIFF(SECOND, t.update_time, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS lock_age_sec,
       ps.picking_after,
       CAST(ps.allow_full_picking AS CHAR) AS allow_full_picking,
       CAST(ps.auto_completed_gd AS CHAR) AS auto_completed_gd,
       CAST(ps.is_loading_bay AS CHAR) AS setup_loading_bay,
       (SELECT CONCAT(CAST(j.id AS CHAR), '|', j.job_status)
          FROM gd_async_job j
         WHERE j.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
           AND j.organization_id = '{{node:code_node_PSguard.data.organizationId}}'
           AND j.idempotency_key = '{{node:code_node_PSguard.data.idempotencyKey}}'
         LIMIT 1) AS key_job,
       (SELECT CONCAT(CAST(j.id AS CHAR), '|', j.job_status)
          FROM gd_async_job j
         WHERE j.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
           AND j.command = 'CONFIRM_PICKING'
           AND j.picking_id = '{{node:code_node_PSguard.data.pickingId}}'
           AND j.is_deleted = 0
           AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING', 'REQUIRES_REVIEW')
         ORDER BY j.id DESC
         LIMIT 1) AS open_job,
       (SELECT COUNT(*)
          FROM transfer_order_jz8m9w3h_sub l
         WHERE l.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
           AND l.transfer_order_id = {{node:code_node_PSguard.data.pickingId}}
           AND l.is_deleted = 0
           AND COALESCE(l.line_status, '') <> 'Cancelled'
           AND l.pending_process_qty > 0
           AND ((l.target_location IS NOT NULL AND l.target_location <> COALESCE(l.source_bin, 0))
             OR (l.target_batch IS NOT NULL AND l.target_batch <> COALESCE(l.batch_no, 0)))) AS moved_rows,
       (SELECT COALESCE(NULLIF(g.delivery_no, ''), CAST(g.id AS CHAR))
          FROM JSON_TABLE(IF(JSON_VALID(t.gd_no), t.gd_no, '[]'), '$[*]' COLUMNS (gid VARCHAR(32) PATH '$')) jt
          JOIN goods_delivery g
            ON g.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
           AND g.id = CAST(jt.gid AS UNSIGNED)
         WHERE g.is_deleted = 0
           AND (g.gd_status = 'Processing'
                OR EXISTS (SELECT 1
                             FROM gd_async_job j
                            WHERE j.tenant_id = g.tenant_id
                              AND j.is_deleted = 0
                              AND j.command IN ('EDIT_GD', 'COMPLETE_GD', 'COMPLETE_PACKING')
                              AND j.correlation_id = CONCAT('GD|', g.id) COLLATE utf8mb4_general_ci
                              AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')))
         LIMIT 1) AS gd_busy
  FROM (SELECT 1 AS one) o
  LEFT JOIN transfer_order t
    ON t.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
   AND t.id = {{node:code_node_PSguard.data.pickingId}}
  LEFT JOIN (SELECT p.picking_after, p.allow_full_picking, p.auto_completed_gd, p.is_loading_bay
               FROM picking_setup p
              WHERE p.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
                AND p.organization_id = '{{node:code_node_PSguard.data.organizationId}}'
                AND p.is_deleted = 0
              ORDER BY p.id
              LIMIT 1) ps
    ON 1 = 1