SELECT g.stock_adjustment_status, NULL AS lock_key, NULL AS owner_operation_id
  FROM stock_adjustment g
 WHERE g.tenant_id = '{{node:code_node_SAguard.data.tenantId}}'
   AND g.id = {{node:code_node_SAguard.data.saId}}
   AND g.is_deleted = 0
UNION ALL
SELECT NULL, l.lock_key, l.owner_operation_id
  FROM inventory_balance_lock l
 WHERE l.tenant_id = '{{node:code_node_SAguard.data.lockTenantId}}'
   AND l.organization_id = '{{node:code_node_SAguard.data.orgId}}'
   AND l.lock_key IN (SELECT jt.k FROM JSON_TABLE('{{node:code_node_SAguard.data.lockKeysJson}}', '$[*]'
                      COLUMNS (k VARCHAR(128) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) jt)
   AND l.free_token = 0
   AND COALESCE(l.owner_operation_id, '') <> ''
   AND l.owner_operation_id NOT LIKE 'CL|%'
   AND l.is_deleted = 0
