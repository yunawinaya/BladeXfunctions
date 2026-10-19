SELECT CAST(l.id AS CHAR) AS id,
       l.temp_qty_data,
       l.picking_status
  FROM goods_delivery_fwii8mvb_sub l
 WHERE l.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND l.id IN ({{node:code_node_PCentry.data.gdLineIdsSql}})
   AND l.is_deleted = 0