SELECT CAST('G' AS CHAR) AS kind,
       CAST(g.id AS CHAR) AS gd_id,
       CAST(g.delivery_no AS CHAR) AS delivery_no,
       CAST(g.gd_status AS CHAR) AS gd_status,
       CAST((SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub gl
              WHERE gl.tenant_id = g.tenant_id AND gl.goods_delivery_id = g.id AND gl.is_deleted = 0) AS CHAR) AS line_count,
       CAST((SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub gl JOIN item i ON i.id = gl.material_id
              WHERE gl.tenant_id = g.tenant_id AND gl.goods_delivery_id = g.id AND gl.is_deleted = 0 AND i.serial_number_management = 1) AS CHAR) AS serial_items,
       CAST(COALESCE(g.is_select_picking, 0) AS CHAR) AS select_picking,
       CAST((SELECT COUNT(*) FROM document_linkage d
              WHERE d.tenant_id = g.tenant_id AND d.is_deleted = 0 AND d.target_doc_type = 'Sales Order' AND d.link_status = 'Linked'
                AND (d.target_doc_id IN (SELECT gl.line_so_id FROM goods_delivery_fwii8mvb_sub gl
                                          WHERE gl.tenant_id = g.tenant_id AND gl.goods_delivery_id = g.id AND gl.is_deleted = 0 AND gl.line_so_id IS NOT NULL)
                     OR d.target_doc_id IN (SELECT CAST(js.s AS CHAR) COLLATE utf8mb4_general_ci
                                              FROM JSON_TABLE(IF(JSON_VALID(g.so_id), g.so_id, '[]'), '$[*]' COLUMNS (s BIGINT PATH '$')) js))) AS CHAR) AS linked,
       CAST((SELECT COUNT(*) FROM gd_async_job j
               JOIN transfer_order t2 ON t2.tenant_id = j.tenant_id AND t2.id = CAST(j.picking_id AS UNSIGNED)
               JOIN JSON_TABLE(IF(JSON_VALID(t2.gd_no), t2.gd_no, '[]'), '$[*]' COLUMNS (gid VARCHAR(32) PATH '$')) jt ON CAST(jt.gid AS UNSIGNED) = g.id
              WHERE j.tenant_id = g.tenant_id AND j.command = 'CONFIRM_PICKING' AND j.is_deleted = 0
                AND j.job_status IN ('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_PICKING', 'REQUIRES_REVIEW')
                AND j.picking_id <> '{{node:code_node_PSguard.data.pickingId}}') AS CHAR) AS other_job,
       CAST(NULL AS CHAR) AS rec_count
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
   AND g.is_deleted = 0
   AND g.id IN (SELECT CAST(i.gd_id AS UNSIGNED) FROM transfer_order_jz8m9w3h_sub i
                 WHERE i.tenant_id = '{{node:code_node_PSguard.data.tenantId}}' AND i.transfer_order_id = {{node:code_node_PSguard.data.pickingId}}
                   AND i.is_deleted = 0 AND COALESCE(i.gd_id, '') <> '')
UNION ALL
SELECT CAST('P' AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR),
       CAST(NULL AS CHAR), CAST(NULL AS CHAR),
       CAST((SELECT COUNT(*) FROM transfer_order_vrqs3cmr_sub r
              WHERE r.tenant_id = '{{node:code_node_PSguard.data.tenantId}}' AND r.transfer_order_id = {{node:code_node_PSguard.data.pickingId}}
                AND r.is_deleted = 0 AND r.store_out_qty > 0) AS CHAR)
