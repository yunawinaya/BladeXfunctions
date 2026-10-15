SELECT CAST(l.id AS CHAR) AS id,
       l.item_id,
       CAST(l.quantity AS CHAR) AS quantity,
       CAST(l.quantity_uom AS CHAR) AS quantity_uom,
       CAST(l.preq_id AS CHAR) AS preq_id,
       CAST(l.preq_line_id AS CHAR) AS preq_line_id,
       CAST(l.parent_id AS CHAR) AS parent_id
  FROM purchase_order_2ukyuanr_sub l
 WHERE l.tenant_id = '{{system:tenantId}}'
   AND l.purchase_order_id = {{node:code_resolve_latest.data.poIdSql}}
   AND l.is_deleted = 0
 ORDER BY COALESCE(l.parent_id, l.id), l.parent_id IS NOT NULL, l.id
