SELECT CAST(b.id AS CHAR) AS id,
       CAST(b.material_id AS CHAR) AS material_id,
       CAST(b.location_id AS CHAR) AS location_id,
       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty
  FROM item_balance b
 WHERE b.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND b.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND b.plant_id = {{node:code_node_rZGbQJid.data.plantId}}
   AND b.is_deleted = 0
   AND (b.material_id, b.location_id) IN ({{node:code_node_rZGbQJid.data.tuplesSql}})