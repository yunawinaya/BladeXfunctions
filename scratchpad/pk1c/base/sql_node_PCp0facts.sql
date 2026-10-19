SELECT CAST('ROW' AS CHAR) AS kind,
       CAST(l.id AS CHAR) AS id,
       CAST(l.pending_process_qty AS CHAR) AS v1,
       CAST(l.line_status AS CHAR) AS v2
  FROM transfer_order_jz8m9w3h_sub l
 WHERE l.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND l.transfer_order_id = {{node:code_node_PCentry.data.pickingId}}
   AND l.is_deleted = 0
   AND l.id IN ({{node:code_node_PCentry.data.rowIdsSql}})
UNION ALL
SELECT CAST('HDR' AS CHAR), CAST(t.id AS CHAR), CAST(t.to_status AS CHAR), CAST(t.is_processing AS CHAR)
  FROM transfer_order t
 WHERE t.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND t.id = {{node:code_node_PCentry.data.pickingId}}
   AND t.is_deleted = 0
UNION ALL
SELECT CAST('GD' AS CHAR), CAST(g.id AS CHAR), CAST(g.gd_status AS CHAR), CAST('' AS CHAR)
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND g.id IN ({{node:code_node_PCentry.data.gdIdsSql}})
   AND g.is_deleted = 0