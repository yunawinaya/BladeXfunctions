SELECT CAST(i.transfer_order_id AS CHAR) AS transfer_order_id, t.to_id, CAST(i.gd_line_id AS CHAR) AS gd_line_id
  FROM transfer_order t
  JOIN transfer_order_jz8m9w3h_sub i ON i.transfer_order_id = t.id AND i.tenant_id = t.tenant_id AND i.is_deleted = 0 AND COALESCE(i.line_status, '') <> 'Cancelled'
 WHERE t.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND t.is_deleted = 0 AND t.id <> {{node:code_node_PPentry.data.pickingId}} AND t.to_status NOT IN ('Completed', 'Cancelled', 'Draft')
   AND COALESCE(i.gd_line_id, '') <> ''
   AND (SELECT COUNT(*) FROM JSON_TABLE(IF(JSON_VALID(t.gd_no), t.gd_no, '[]'), '$[*]' COLUMNS (gid VARCHAR(32) PATH '$')) jt
                WHERE CAST(jt.gid AS UNSIGNED) IN (SELECT CAST(i.gd_id AS UNSIGNED) FROM transfer_order_jz8m9w3h_sub i
                                  WHERE i.transfer_order_id = {{node:code_node_PPentry.data.pickingId}} AND i.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND i.is_deleted = 0 AND COALESCE(i.gd_id, '') <> '')) > 0
