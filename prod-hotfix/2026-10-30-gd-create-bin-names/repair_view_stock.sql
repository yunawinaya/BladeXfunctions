-- Kenhin (tenant 528521): GD lines whose delivery summary (view_stock) shows a bin id instead of its name. GD Created V2
-- read only the plant's first 500 bins by id; these 2 bins come after them and hold stock:
--   2011257408998285313 -> 501
--   2011257803980087797 -> 1500
-- Completed / Cancelled GDs only; the text is display only (nothing else reads it). update_time is left as it is. Built by build.py.
-- Run AFTER the GD_BULK_PREPARE paste; safe to run again (a repaired summary no longer matches).

-- PART 1: lines to repair, per bin id
SELECT REGEXP_SUBSTR(l.view_stock, '[0-9]{18,20}(?=:)') AS bin_id, COUNT(*) AS lines_n
  FROM goods_delivery_fwii8mvb_sub l JOIN goods_delivery g ON g.id = l.goods_delivery_id
 WHERE l.tenant_id = '528521' AND l.is_deleted = 0 AND g.gd_status IN ('Completed', 'Cancelled') AND l.view_stock REGEXP '[0-9]\\. [0-9]{18,20}:'
 GROUP BY bin_id;

-- PART 2: one UPDATE per bin (rows affected = PART 1's count for that bin)
UPDATE goods_delivery_fwii8mvb_sub l JOIN goods_delivery g ON g.id = l.goods_delivery_id
   SET l.view_stock = REPLACE(l.view_stock, '. 2011257408998285313:', '. 501:')
 WHERE l.tenant_id = '528521' AND l.is_deleted = 0 AND g.gd_status IN ('Completed', 'Cancelled')
   AND l.view_stock LIKE '%. 2011257408998285313:%';

UPDATE goods_delivery_fwii8mvb_sub l JOIN goods_delivery g ON g.id = l.goods_delivery_id
   SET l.view_stock = REPLACE(l.view_stock, '. 2011257803980087797:', '. 1500:')
 WHERE l.tenant_id = '528521' AND l.is_deleted = 0 AND g.gd_status IN ('Completed', 'Cancelled')
   AND l.view_stock LIKE '%. 2011257803980087797:%';

-- PART 3: after-check, expect no rows
SELECT REGEXP_SUBSTR(l.view_stock, '[0-9]{18,20}(?=:)') AS bin_id, COUNT(*) AS lines_n
  FROM goods_delivery_fwii8mvb_sub l JOIN goods_delivery g ON g.id = l.goods_delivery_id
 WHERE l.tenant_id = '528521' AND l.is_deleted = 0 AND g.gd_status IN ('Completed', 'Cancelled') AND l.view_stock REGEXP '[0-9]\\. [0-9]{18,20}:'
 GROUP BY bin_id;
