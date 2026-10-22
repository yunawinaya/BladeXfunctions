SELECT 'OP' AS kind, o.operation_status AS k, o.result_code AS v, CAST(o.row_version AS CHAR) AS n
  FROM inventory_operation o
 WHERE o.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND o.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND o.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND o.is_deleted = 0
UNION ALL
SELECT 'GATE' AS kind, g.lock_key AS k, g.owner_operation_id AS v, CAST(g.free_token AS CHAR) AS n
  FROM inventory_balance_lock g
 WHERE g.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND g.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND g.lock_key = CONCAT('GATE|', '{{node:code_node_cW0Exw93.data.operationId}}')
UNION ALL
SELECT 'EFFECTS' AS kind, e.effect_status AS k, '' AS v, CAST(COUNT(*) AS CHAR) AS n
  FROM inventory_operation_effect e
 WHERE e.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND e.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND e.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND e.is_deleted = 0
 GROUP BY e.effect_status
UNION ALL
SELECT 'LOCKS_OWNED' AS kind, '' AS k, '' AS v, CAST(COUNT(*) AS CHAR) AS n
  FROM inventory_balance_lock l
 WHERE l.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND l.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND l.owner_operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND l.balance_type IN ('ITEM', 'BATCH', 'HU', 'RESERVATION')
   AND l.is_deleted = 0