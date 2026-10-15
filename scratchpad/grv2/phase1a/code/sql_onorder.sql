SELECT CAST(o.id AS CHAR) AS id,
       CAST(o.po_id AS CHAR) AS po_id,
       CAST(o.po_line_id AS CHAR) AS po_line_id,
       CAST(o.material_id AS CHAR) AS material_id,
       o.purchase_order_number,
       o.purchase_order_line,
       CAST(o.received_qty AS CHAR) AS received_qty
  FROM on_order_purchase_order o
 WHERE o.tenant_id = '{{system:tenantId}}'
   AND o.is_deleted = 0
   AND o.organization_id = '{{node:code_resolve_latest.data.orgSql}}'
   AND (o.po_id = {{node:code_resolve_latest.data.poIdSql}}
        OR o.purchase_order_number = CONVERT(UNHEX('{{node:code_resolve_latest.data.poNoHex}}') USING utf8mb4) COLLATE utf8mb4_general_ci)
 ORDER BY o.id
