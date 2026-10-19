SELECT CAST(goods_delivery_id AS CHAR) AS gd_id,
       COUNT(*) AS line_count
FROM goods_delivery_fwii8mvb_sub
WHERE goods_delivery_id IN ({{node:code_node_SizeGuardPrep.data.gdIdCsv}})
  AND is_deleted = 0
GROUP BY goods_delivery_id