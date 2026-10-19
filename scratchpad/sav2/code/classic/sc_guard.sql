SELECT COUNT(*) AS busy_count
  FROM stock_adjustment g
 WHERE g.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND g.stock_count_id = {{node:code_node_SCguard.data.scId}}
   AND {{node:code_node_SCguard.data.scId}} > 0
   AND g.stock_adjustment_status = 'Processing'
   AND g.is_deleted = 0
