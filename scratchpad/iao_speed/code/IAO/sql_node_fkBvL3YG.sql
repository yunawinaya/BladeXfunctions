SELECT CAST(i.id AS CHAR) AS id,
       i.material_costing_method AS material_costing_method,
       CAST(i.item_batch_management AS CHAR) AS item_batch_management,
       CAST(i.serial_number_management AS CHAR) AS serial_number_management,
       CAST(i.stock_control AS CHAR) AS stock_control,
       CAST(i.based_uom AS CHAR) AS based_uom,
       CAST(i.purchase_unit_price AS CHAR) AS purchase_unit_price,
       CAST(i.is_deleted AS CHAR) AS is_deleted,
       CAST(i.is_active AS CHAR) AS is_active
  FROM item i
 WHERE i.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND i.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND i.id IN ({{node:code_node_cW0Exw93.data.materialIdsSql}})