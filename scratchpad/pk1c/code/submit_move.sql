SELECT CAST('R' AS CHAR) AS kind,
       CAST(x.id AS CHAR) AS row_id,
       CAST(x.gd_id AS CHAR) AS gd_id,
       CAST(x.moved AS CHAR) AS moved,
       CAST(x.bay_bad AS CHAR) AS bay_bad,
       CAST(x.handling_unit_id AS CHAR) AS hu,
       CAST(x.label AS CHAR) AS label,
       CAST(NULL AS CHAR) AS delivery_no,
       CAST(NULL AS CHAR) AS line_count,
       CAST(NULL AS CHAR) AS serial_items,
       CAST(NULL AS CHAR) AS select_picking,
       CAST(NULL AS CHAR) AS linked,
       CAST(NULL AS CHAR) AS other_job
  FROM (@ROWS@) x
 WHERE x.moved = 1
    OR (x.bay_bad = 1
        AND (SELECT COALESCE(ps.is_loading_bay, 0) FROM picking_setup ps
              WHERE ps.tenant_id = '{{node:code_node_PSguard.data.tenantId}}' AND ps.organization_id = '{{node:code_node_PSguard.data.organizationId}}'
                AND ps.is_deleted = 0
              ORDER BY ps.id LIMIT 1) = 1)
UNION ALL
SELECT CAST('G' AS CHAR),
       CAST(NULL AS CHAR),
       CAST(g.id AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(NULL AS CHAR),
       CAST(g.delivery_no AS CHAR),
       CAST((SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub gl
              WHERE gl.tenant_id = g.tenant_id AND gl.goods_delivery_id = g.id AND gl.is_deleted = 0) AS CHAR),
       CAST((SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub gl JOIN item i ON i.id = gl.material_id
              WHERE gl.tenant_id = g.tenant_id AND gl.goods_delivery_id = g.id AND gl.is_deleted = 0 AND i.serial_number_management = 1) AS CHAR),
       CAST(COALESCE(g.is_select_picking, 0) AS CHAR),
       CAST((SELECT COUNT(*) FROM document_linkage d
              WHERE d.tenant_id = g.tenant_id AND d.is_deleted = 0 AND d.target_doc_type = 'Sales Order' AND d.link_status = 'Linked'
                AND (d.target_doc_id IN (SELECT gl.line_so_id FROM goods_delivery_fwii8mvb_sub gl
                                          WHERE gl.tenant_id = g.tenant_id AND gl.goods_delivery_id = g.id AND gl.is_deleted = 0 AND gl.line_so_id IS NOT NULL)
                     OR d.target_doc_id IN (SELECT CAST(js.s AS CHAR) COLLATE utf8mb4_general_ci
                                              FROM JSON_TABLE(IF(JSON_VALID(g.so_id), g.so_id, '[]'), '$[*]' COLUMNS (s BIGINT PATH '$')) js))) AS CHAR),
       CAST((SELECT COUNT(*) FROM gd_async_job j
               JOIN transfer_order t2 ON t2.tenant_id = j.tenant_id AND t2.id = CAST(j.picking_id AS UNSIGNED)
               JOIN JSON_TABLE(IF(JSON_VALID(t2.gd_no), t2.gd_no, '[]'), '$[*]' COLUMNS (gid VARCHAR(32) PATH '$')) jt ON CAST(jt.gid AS UNSIGNED) = g.id
              WHERE j.tenant_id = g.tenant_id AND j.command = 'CONFIRM_PICKING' AND j.is_deleted = 0
                AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING', 'REQUIRES_REVIEW')
                AND j.picking_id <> '{{node:code_node_PSguard.data.pickingId}}') AS CHAR)
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
   AND g.id IN (SELECT y.gd_id FROM (@ROWS@) y WHERE y.moved = 1)
