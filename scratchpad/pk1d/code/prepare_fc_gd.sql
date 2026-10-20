SELECT CAST(gl.id AS CHAR) AS id, CAST(gl.goods_delivery_id AS CHAR) AS goods_delivery_id, g.delivery_no, g.gd_status,
       CAST(gl.material_id AS CHAR) AS material_id, gl.material_name, gl.gd_qty, gl.base_qty, gl.gd_order_quantity, gl.gd_initial_delivered_qty,
       CAST(gl.gd_order_uom_id AS CHAR) AS gd_order_uom_id, gl.temp_qty_data, gl.temp_hu_data, gl.view_stock, gl.plan_qty, gl.plan_temp_qty_data, gl.plan_view_stock,
       gl.picking_status, CAST(gl.item_bundle_id AS CHAR) AS item_bundle_id, CAST(gl.parent_id AS CHAR) AS parent_id, CAST(gl.so_line_item_id AS CHAR) AS so_line_item_id
  FROM goods_delivery_fwii8mvb_sub gl
  JOIN goods_delivery g ON g.id = gl.goods_delivery_id AND g.is_deleted = 0
 WHERE gl.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND gl.is_deleted = 0
   AND gl.goods_delivery_id IN (SELECT CAST(i.gd_id AS UNSIGNED) FROM transfer_order_jz8m9w3h_sub i
                                 WHERE i.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND i.transfer_order_id = {{node:code_node_PPentry.data.pickingId}} AND i.is_deleted = 0 AND COALESCE(i.gd_id, '') <> '')
 ORDER BY gl.goods_delivery_id, gl.id
