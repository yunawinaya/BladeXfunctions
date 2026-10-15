SELECT CAST(p.id AS CHAR) AS id, CAST(p.purchase_order_id AS CHAR) AS po_id,
       p.created_received_qty, SUM(l.received_qty) AS rev
  FROM goods_receiving_eg6l4ywi_sub l
  JOIN purchase_order_2ukyuanr_sub p ON p.id = l.po_line_item_id AND p.is_deleted = 0
  JOIN purchase_order h ON h.id = p.purchase_order_id AND h.is_deleted = 0
 WHERE l.goods_receiving_id IN ({{node:code_node_CcGuardKey.data.idsCsv}})
   AND l.tenant_id = '{{system:tenantId}}'
   AND l.is_deleted = 0
   AND NOT (COALESCE(l.is_split, '') = 'Yes' AND COALESCE(l.parent_or_child, '') = 'Parent')
 GROUP BY p.id, p.purchase_order_id, p.created_received_qty
