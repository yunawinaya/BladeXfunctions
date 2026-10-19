SELECT CAST('L' AS CHAR) AS k,
       CAST(JSON_OBJECT('id', CAST(l.id AS CHAR), 'temp_qty_data', l.temp_qty_data, 'view_stock', l.view_stock, 'prev_temp_qty_data', l.prev_temp_qty_data) AS CHAR) AS j
  FROM goods_delivery_fwii8mvb_sub l
 WHERE l.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND l.id IN (SELECT jt.i FROM JSON_TABLE('{{node:code_node_PCmvparse.data.lineIdsJson}}', '$[*]' COLUMNS (i BIGINT PATH '$')) jt)
   AND l.is_deleted = 0
