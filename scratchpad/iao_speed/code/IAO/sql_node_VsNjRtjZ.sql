SELECT CAST(e.id AS CHAR) AS id, e.effect_key AS effect_key, e.effect_status AS effect_status, e.movement_id AS movement_id
  FROM inventory_operation_effect e
 WHERE e.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND e.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND e.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND e.is_deleted = 0