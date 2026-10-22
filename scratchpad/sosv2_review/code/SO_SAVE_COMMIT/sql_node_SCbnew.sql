SELECT CAST(l.id AS CHAR) AS id,
       l.line_index,
       CAST(l.parent_id AS CHAR) AS parent_id
  FROM sales_order_axszx8cj_sub l
 WHERE l.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND l.is_deleted = 0
   AND l.sales_order_id = {{node:code_node_SCgate.data.soIdSql}}
   AND l.id NOT IN ({{node:code_node_SCb.data.storedIdsSql}})