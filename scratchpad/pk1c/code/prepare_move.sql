SELECT CAST('L' AS CHAR) AS kind,
       CAST(l.id AS CHAR) AS id,
       CAST(l.goods_delivery_id AS CHAR) AS gd_id,
       CAST(l.material_id AS CHAR) AS material_id,
       CAST(l.picking_status AS CHAR) AS picking_status,
       CAST(l.temp_qty_data AS CHAR) AS temp_qty_data,
       CAST(l.view_stock AS CHAR) AS view_stock,
       CAST(NULL AS CHAR) AS plant_id,
       CAST(NULL AS CHAR) AS name,
       CAST(NULL AS CHAR) AS line_count,
       CAST(NULL AS CHAR) AS linked,
       CAST(NULL AS CHAR) AS other_job
  FROM goods_delivery_fwii8mvb_sub l
 WHERE l.tenant_id = '{{node:code_node_PPentry.data.tenantId}}'
   AND l.id IN ({{node:code_node_PPplan.data.moveGdLineIdsSql}})
   AND l.is_deleted = 0
UNION ALL
SELECT CAST('B' AS CHAR), CAST(b.id AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR),
       CAST(b.plant_id AS CHAR), CAST(COALESCE(NULLIF(b.bin_location_combine, ''), b.bin_name) AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR)
  FROM bin_location b
 WHERE b.tenant_id = '{{node:code_node_PPentry.data.tenantId}}'
   AND b.is_deleted = 0
   AND (b.id IN ({{node:code_node_PPplan.data.moveBinIdsSql}})
        OR b.id IN (SELECT jt.loc
                      FROM goods_delivery_fwii8mvb_sub l2,
                           JSON_TABLE(IF(JSON_VALID(l2.temp_qty_data), l2.temp_qty_data, '[]'), '$[*]' COLUMNS (loc BIGINT PATH '$.location_id' NULL ON EMPTY NULL ON ERROR)) jt
                     WHERE l2.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND l2.id IN ({{node:code_node_PPplan.data.moveGdLineIdsSql}})))
UNION ALL
SELECT CAST('T' AS CHAR), CAST(t.id AS CHAR), CAST(NULL AS CHAR), CAST(t.material_id AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR),
       CAST(t.plant_id AS CHAR), CAST(t.batch_number AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR)
  FROM batch t
 WHERE t.tenant_id = '{{node:code_node_PPentry.data.tenantId}}'
   AND t.is_deleted = 0
   AND (t.id IN ({{node:code_node_PPplan.data.moveBatchIdsSql}})
        OR t.id IN (SELECT jt.bat
                      FROM goods_delivery_fwii8mvb_sub l2,
                           JSON_TABLE(IF(JSON_VALID(l2.temp_qty_data), l2.temp_qty_data, '[]'), '$[*]' COLUMNS (bat BIGINT PATH '$.batch_id' NULL ON EMPTY NULL ON ERROR)) jt
                     WHERE l2.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND l2.id IN ({{node:code_node_PPplan.data.moveGdLineIdsSql}})))
UNION ALL
SELECT CAST('H' AS CHAR), CAST(h.id AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR),
       CAST(NULL AS CHAR), CAST(h.handling_no AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR)
  FROM handling_unit h
 WHERE h.tenant_id = '{{node:code_node_PPentry.data.tenantId}}'
   AND h.is_deleted = 0
   AND h.id IN (SELECT jt.hu
                  FROM goods_delivery_fwii8mvb_sub l2,
                       JSON_TABLE(IF(JSON_VALID(l2.temp_qty_data), l2.temp_qty_data, '[]'), '$[*]' COLUMNS (hu BIGINT PATH '$.handling_unit_id' NULL ON EMPTY NULL ON ERROR)) jt
                 WHERE l2.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND l2.id IN ({{node:code_node_PPplan.data.moveGdLineIdsSql}}))
UNION ALL
SELECT CAST('G' AS CHAR), CAST(g.id AS CHAR), CAST(g.id AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR),
       CAST(NULL AS CHAR), CAST(g.delivery_no AS CHAR),
       CAST((SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub gl
              WHERE gl.tenant_id = g.tenant_id AND gl.goods_delivery_id = g.id AND gl.is_deleted = 0) AS CHAR),
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
                AND j.picking_id <> '{{node:code_node_PPentry.data.pickingId}}') AS CHAR)
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_PPentry.data.tenantId}}'
   AND g.id IN (SELECT l3.goods_delivery_id FROM goods_delivery_fwii8mvb_sub l3
                 WHERE l3.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND l3.id IN ({{node:code_node_PPplan.data.moveGdLineIdsSql}}))
