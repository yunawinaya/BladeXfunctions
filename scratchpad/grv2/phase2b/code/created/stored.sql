SELECT g.gr_status, g.gr_no,
       CAST(l.po_line_item_id AS CHAR) AS po_line_id, SUM(l.received_qty) AS qty
  FROM goods_receiving g
  LEFT JOIN goods_receiving_eg6l4ywi_sub l
    ON l.goods_receiving_id = g.id AND l.is_deleted = 0 AND l.po_line_item_id IS NOT NULL
   AND NOT (COALESCE(l.is_split, '') = 'Yes' AND COALESCE(l.parent_or_child, '') = 'Parent')
 WHERE g.tenant_id = '{{system:tenantId}}'
   AND g.id = {{node:code_node_GcPrep.data.grId}}
   AND g.is_deleted = 0
 GROUP BY g.gr_status, g.gr_no, l.po_line_item_id
