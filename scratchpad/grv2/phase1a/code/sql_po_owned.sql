SELECT CAST(l.id AS CHAR) AS id,
       CAST(l.received_qty AS CHAR) AS received_qty,
       CAST(l.created_received_qty AS CHAR) AS created_received_qty,
       CAST(l.invoice_qty AS CHAR) AS invoice_qty,
       CAST(l.return_quantity AS CHAR) AS return_quantity,
       CAST(l.created_return_qty AS CHAR) AS created_return_qty,
       l.line_status AS line_status,
       h.po_status AS head_po_status
  FROM purchase_order h
  LEFT JOIN purchase_order_2ukyuanr_sub l
    ON l.purchase_order_id = h.id AND l.tenant_id = h.tenant_id AND l.is_deleted = 0
 WHERE h.tenant_id = '{{system:tenantId}}'
   AND h.id = {{node:code_pre.data.poIdSql}}
   AND h.is_deleted = 0
