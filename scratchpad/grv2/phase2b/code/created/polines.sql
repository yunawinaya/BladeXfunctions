SELECT CAST(p.id AS CHAR) AS id, CAST(p.purchase_order_id AS CHAR) AS po_id,
       p.quantity, p.received_qty, p.created_received_qty
  FROM (SELECT sel.lid
          FROM JSON_TABLE(CONCAT('[', '{{node:code_node_GcPrep.data.poLineCsv}}', ']'),
                          '$[*]' COLUMNS (lid BIGINT PATH '$')) sel
        UNION
        SELECT l.po_line_item_id
          FROM goods_receiving_eg6l4ywi_sub l
         WHERE {{node:code_node_GcPrep.data.grId}} <> 0
           AND l.goods_receiving_id = {{node:code_node_GcPrep.data.grId}}
           AND l.is_deleted = 0 AND l.po_line_item_id IS NOT NULL) ids
  JOIN purchase_order_2ukyuanr_sub p ON p.id = ids.lid AND p.is_deleted = 0
  JOIN purchase_order h ON h.id = p.purchase_order_id AND h.is_deleted = 0
 WHERE p.tenant_id = '{{system:tenantId}}'
