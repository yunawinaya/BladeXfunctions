SELECT CAST(i.id AS CHAR) AS id,
       (SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'base_qty', u.base_qty))
          FROM item_mji552rc_sub u
         WHERE u.Item_id = i.id
           AND u.is_deleted = 0) AS uom_json
  FROM (SELECT DISTINCT CAST(l.item_id AS UNSIGNED) AS mid
          FROM purchase_order_2ukyuanr_sub l
         WHERE l.tenant_id = '{{system:tenantId}}'
           AND l.purchase_order_id = {{node:code_resolve_latest.data.poIdSql}}
           AND l.is_deleted = 0
           AND l.item_id REGEXP '^[0-9]{1,19}$') sel
  JOIN item i
    ON i.id = sel.mid
   AND i.tenant_id = '{{system:tenantId}}'
   AND i.is_deleted = 0
