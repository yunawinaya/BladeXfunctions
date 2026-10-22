SELECT CAST(b.id AS CHAR) AS id,
       CAST(b.material_id AS CHAR) AS material_id,
       CAST(b.location_id AS CHAR) AS location_id,
       CAST(b.batch_id AS CHAR) AS batch_id,
       CAST(b.material_uom AS CHAR) AS material_uom,
       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty,
       CAST(b.reserved_qty AS CHAR) AS reserved_qty,
       CAST(b.block_qty AS CHAR) AS block_qty,
       CAST(b.qualityinsp_qty AS CHAR) AS qualityinsp_qty,
       CAST(b.intransit_qty AS CHAR) AS intransit_qty,
       CAST(b.balance_quantity AS CHAR) AS balance_quantity,
       DATE_FORMAT(b.manufacturing_date, '%Y-%m-%d %H:%i:%s') AS manufacturing_date,
       DATE_FORMAT(b.expired_date, '%Y-%m-%d %H:%i:%s') AS expired_date
  FROM item_batch_balance b
 WHERE b.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND b.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND b.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND b.is_deleted = 0
   AND (b.material_id, b.location_id, b.batch_id) IN ({{node:code_node_cW0Exw93.data.batchTuplesSql}})