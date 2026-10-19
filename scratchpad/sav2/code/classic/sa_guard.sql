SELECT g.stock_adjustment_status
  FROM stock_adjustment g
 WHERE g.tenant_id = '{{node:code_node_SAguard.data.tenantId}}'
   AND g.id = {{node:code_node_SAguard.data.saId}}
   AND g.is_deleted = 0
