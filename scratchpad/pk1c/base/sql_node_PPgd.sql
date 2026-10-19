SELECT CAST(l.id AS CHAR) AS id,
       CAST(l.goods_delivery_id AS CHAR) AS goods_delivery_id,
       l.picking_status,
       g.gd_status,
       CAST(l.gd_qty AS CHAR) AS gd_qty,
       l.material_name
  FROM goods_delivery_fwii8mvb_sub l
  JOIN goods_delivery g
    ON g.id = l.goods_delivery_id
   AND g.tenant_id = '{{node:code_node_PPguard.data.tenantId}}'
 WHERE l.tenant_id = '{{node:code_node_PPguard.data.tenantId}}'
   AND l.is_deleted = 0
   AND l.goods_delivery_id IN (SELECT p.gd_id
                                 FROM transfer_order_jz8m9w3h_sub p
                                WHERE p.tenant_id = '{{node:code_node_PPguard.data.tenantId}}'
                                  AND p.transfer_order_id = {{node:code_node_PPentry.data.pickingId}}
                                  AND p.is_deleted = 0
                                  AND p.gd_id IS NOT NULL)