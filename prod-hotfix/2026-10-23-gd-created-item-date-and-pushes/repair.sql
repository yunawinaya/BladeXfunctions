-- Prod repair 2026-10-23 (optional): Item last_transaction_date behind the date of a GD Created V2 delivery (V2 never wrote it
-- until the GD_BULK_COMMIT P7F fix). Only the date's presence is read; on 10-23 this matched 1 item and no empty one.
-- Run AFTER the GD_BULK_COMMIT paste. The value is the delivery's date at midnight, as the platform stores what V2 / classic write.

-- 1. preview
SELECT i.tenant_id, CAST(i.id AS CHAR) AS item_id, i.material_code, i.last_transaction_date, x.d AS v2_gd_date
  FROM item i
  JOIN (SELECT l.material_id, DATE(MAX(g.create_time)) AS d
          FROM goods_delivery g
          JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0 AND l.material_id IS NOT NULL
         WHERE g.id > 2112936949969846272 AND g.is_deleted = 0 AND g.gd_dockey IS NOT NULL AND g.gd_dockey <> ''
         GROUP BY l.material_id) x ON x.material_id = i.id
 WHERE i.is_deleted = 0 AND (i.last_transaction_date IS NULL OR i.last_transaction_date < x.d);

-- 2. update (the same rows)
UPDATE item i
  JOIN (SELECT l.material_id, DATE(MAX(g.create_time)) AS d
          FROM goods_delivery g
          JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0 AND l.material_id IS NOT NULL
         WHERE g.id > 2112936949969846272 AND g.is_deleted = 0 AND g.gd_dockey IS NOT NULL AND g.gd_dockey <> ''
         GROUP BY l.material_id) x ON x.material_id = i.id
   SET i.last_transaction_date = x.d
 WHERE i.is_deleted = 0 AND (i.last_transaction_date IS NULL OR i.last_transaction_date < x.d);
