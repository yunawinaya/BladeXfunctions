-- LSH (128671), 10-27: put back the classic delivery lost on one batch row during GD-2610-1774's stop.
-- At 15:15:35 GD-2610-1713 (classic, takes no locks) delivered 1 unit from Reserved of batch 2113417298927816706 at bin
-- 2079487564737286146. The movement exists, and the item total (item_balance 2113417299326275585) shows it: reserved 3,
-- balance 118. On the batch row, 1774's stock call `|2` wrote its planned values (reserved 4 / balance 59, from what it had
-- read a moment earlier) over it. The repair's undo + retry were by delta, so they kept that error as it was.
-- Now: batch rows at the bin = 4 + 0 reserved, 59 + 60 balance; the item total = 3 / 118; movements say reserved 3.
-- Fix: this batch row reserved - 1, balance - 1 -> 3 / 55 / 58, only while it still holds exactly 4 / 55 / 59.

-- 1. Preview: must return reserved 4, unrestricted 55, balance 59.
SELECT CAST(id AS CHAR) AS id, reserved_qty, unrestricted_qty, balance_quantity
  FROM item_batch_balance
 WHERE tenant_id = '128671' AND id = 2113417299200446466 AND is_deleted = 0;

-- 2. Fix: expect "1 row affected".
UPDATE item_batch_balance
   SET reserved_qty = reserved_qty - 1,
       balance_quantity = balance_quantity - 1,
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '128671'
   AND id = 2113417299200446466
   AND reserved_qty = 4 AND unrestricted_qty = 55 AND balance_quantity = 59
   AND is_deleted = 0;

-- 3. Check: the batch rows now add up to the item total (reserved 3, balance 118).
SELECT SUM(reserved_qty) AS batch_reserved, SUM(balance_quantity) AS batch_balance,
       (SELECT reserved_qty FROM item_balance WHERE tenant_id = '128671' AND id = 2113417299326275585) AS item_reserved,
       (SELECT balance_quantity FROM item_balance WHERE tenant_id = '128671' AND id = 2113417299326275585) AS item_balance
  FROM item_batch_balance
 WHERE tenant_id = '128671' AND material_id = 2113379973657141255 AND location_id = 2079487564737286146 AND is_deleted = 0;
