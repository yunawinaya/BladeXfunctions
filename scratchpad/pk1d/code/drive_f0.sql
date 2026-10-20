SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now, CAST('P' AS CHAR) AS kind, CAST(t.id AS CHAR) AS id, CAST(t.to_status AS CHAR) AS status,
       CAST(t.is_deleted AS CHAR) AS a, CAST(t.is_processing AS CHAR) AS b, CAST(NULL AS CHAR) AS c
  FROM transfer_order t
 WHERE t.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
   AND t.id = {{node:code_node_DRentry.data.pickingId}}
UNION ALL
SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s'), CAST('R' AS CHAR), CAST(i.id AS CHAR), CAST(i.line_status AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR)
  FROM transfer_order_jz8m9w3h_sub i
 WHERE i.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
   AND i.transfer_order_id = {{node:code_node_DRentry.data.pickingId}}
   AND i.is_deleted = 0
UNION ALL
SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s'), CAST('A' AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(COUNT(*) AS CHAR), CAST(SUM(r.store_out_qty) AS CHAR),
       CAST(MAX(r.id) AS CHAR)
  FROM transfer_order_vrqs3cmr_sub r
 WHERE r.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
   AND r.transfer_order_id = {{node:code_node_DRentry.data.pickingId}}
   AND r.is_deleted = 0
UNION ALL
SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s'), CAST('G' AS CHAR), CAST(g.id AS CHAR), CAST(g.gd_status AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR), CAST(NULL AS CHAR)
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_DRguard.data.tenantId}}'
   AND g.id IN ({{node:code_node_DRentry.data.gdIdsAllSql}})
   AND g.is_deleted = 0
