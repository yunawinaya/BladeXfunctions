SELECT CAST(gl.id AS CHAR) AS gd_line_id,
       gl.gd_qty,
       COALESCE(NULLIF(g.delivery_no, ''), CAST(g.id AS CHAR)) AS delivery_no,
       COALESCE(NULLIF(gl.material_name, ''), CAST(gl.id AS CHAR)) AS item_name,
       COALESCE(o.covered, 0) AS covered,
       o.pickings
  FROM JSON_TABLE(CONCAT('[', '{{node:code_node_CoverIds.data.lineIdCsv}}', ']'), '$[*]' COLUMNS (lid BIGINT PATH '$')) l
  JOIN goods_delivery_fwii8mvb_sub gl ON gl.id = l.lid AND gl.tenant_id = '{{system:tenantId}}'
  JOIN goods_delivery g ON g.id = gl.goods_delivery_id
  LEFT JOIN (SELECT x.gd_line_id, SUM(x.qty) AS covered, GROUP_CONCAT(DISTINCT x.to_no ORDER BY x.to_no SEPARATOR ', ') AS pickings
               FROM (SELECT i.gd_line_id, i.qty_to_pick AS qty, t.to_id AS to_no
                       FROM transfer_order t
                       JOIN transfer_order_jz8m9w3h_sub i ON i.transfer_order_id = t.id AND i.tenant_id = t.tenant_id AND i.is_deleted = 0
                      WHERE t.tenant_id = '{{system:tenantId}}'
                        AND t.is_deleted = 0
                        AND t.to_status NOT IN ('Completed', 'Cancelled', 'Draft')
                        AND t.id NOT IN ({{node:code_node_CoverIds.data.ownIdCsv}})
                        AND COALESCE(i.line_status, '') <> 'Cancelled'
                        AND COALESCE(i.row_type, '') <> 'header'
                        AND (JSON_OVERLAPS(t.gd_no, CAST(CONCAT('[', '{{node:code_node_CoverIds.data.gdIdCsv}}', ']') AS JSON))
                             OR JSON_OVERLAPS(t.gd_no, (SELECT JSON_ARRAYAGG(CAST(d.id AS CHAR))
                                                          FROM JSON_TABLE(CONCAT('[', '{{node:code_node_CoverIds.data.gdIdCsv}}', ']'),
                                                                          '$[*]' COLUMNS (id BIGINT PATH '$')) d)))
                     UNION ALL
                     SELECT r.gd_line_id, COALESCE(r.store_out_qty, 0) AS qty, t.to_id AS to_no
                       FROM transfer_order t
                       JOIN transfer_order_vrqs3cmr_sub r ON r.transfer_order_id = t.id AND r.tenant_id = t.tenant_id AND r.is_deleted = 0
                      WHERE t.tenant_id = '{{system:tenantId}}'
                        AND t.is_deleted = 0
                        AND t.to_status = 'Completed'
                        AND t.id NOT IN ({{node:code_node_CoverIds.data.ownIdCsv}})
                        AND (JSON_OVERLAPS(t.gd_no, CAST(CONCAT('[', '{{node:code_node_CoverIds.data.gdIdCsv}}', ']') AS JSON))
                             OR JSON_OVERLAPS(t.gd_no, (SELECT JSON_ARRAYAGG(CAST(d.id AS CHAR))
                                                          FROM JSON_TABLE(CONCAT('[', '{{node:code_node_CoverIds.data.gdIdCsv}}', ']'),
                                                                          '$[*]' COLUMNS (id BIGINT PATH '$')) d)))) x
              GROUP BY x.gd_line_id) o ON o.gd_line_id = gl.id
