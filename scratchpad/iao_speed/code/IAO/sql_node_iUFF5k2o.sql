SELECT 'BATCH_ROWS' AS kind, CAST(b.material_id AS CHAR) AS material_id, CAST(b.location_id AS CHAR) AS location_id, '' AS k, COUNT(*) AS n
  FROM item_batch_balance b
 WHERE b.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND b.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND b.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND b.is_deleted = 0
   AND (b.material_id, b.location_id) IN ({{node:code_node_cW0Exw93.data.itemTuplesSql}})
 GROUP BY b.material_id, b.location_id
UNION ALL
SELECT 'SERIAL_ROWS' AS kind, CAST(s.material_id AS CHAR) AS material_id, CAST(s.location_id AS CHAR) AS location_id, '' AS k, COUNT(*) AS n
  FROM item_serial_balance s
 WHERE s.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND s.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND s.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND s.is_deleted = 0
   AND (s.material_id, s.location_id) IN ({{node:code_node_cW0Exw93.data.itemTuplesSql}})
 GROUP BY s.material_id, s.location_id
UNION ALL
SELECT 'MOVEMENT_KEY' AS kind, '' AS material_id, '' AS location_id, CAST(m.operation_effect_key AS CHAR) AS k, COUNT(*) AS n
  FROM inventory_movement m
 WHERE m.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND m.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND m.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND NULLIF(m.operation_effect_key, '') IN ({{node:code_node_cW0Exw93.data.movementKeysSql}})
 GROUP BY m.operation_effect_key