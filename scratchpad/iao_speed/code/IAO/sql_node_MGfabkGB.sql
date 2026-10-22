SELECT 'OP' AS kind, CAST(o.id AS CHAR) AS id, o.operation_id AS k, o.operation_status AS status, o.request_hash AS request_hash
  FROM inventory_operation o
 WHERE o.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND o.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND o.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND o.is_deleted = 0
UNION ALL
SELECT 'EFF' AS kind, CAST(e.id AS CHAR) AS id, e.effect_key AS k, e.effect_status AS status, '' AS request_hash
  FROM inventory_operation_effect e
 WHERE e.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND e.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND e.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND e.is_deleted = 0