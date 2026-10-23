-- Prod repair 2026-10-23, tenant 128671 (LSH): GD-2610-971 delivered 1 carton (箱CTN) of Instant Noodle 唯一面 VIT'S
-- (item 2113379350937214980, base 包Paket, 1 箱Ctn = 6 包Paket) but the classic save took 1 packet instead of 6: the order line
-- carried the twin unit 箱CTN (AutoCount sync bug), which the item does not know, and classic counted it 1:1.
-- This makes it 6 packets: the 5 missing packets come off bin Tingkat 2-S7-L, batch 1050-012-0001 (2113416533530251266).
--   1. Tingkat balances (item + batch): unrestricted and total -5 (relative: concurrent deliveries are not overwritten)
--   2. the batch's FIFO layer: available -5 (cost is 0: no value changes)
--   3. GD-2610-971's line: base_qty 1 -> 6 (the 1 carton stays)
--   4. its 5 stock movements: base_qty 1 -> 6, actual_base_qty -1/+1 -> -6/+6 (the 1 carton stays) - LAST: the "done" marker.
-- Steps 1-3 run only while movement 2113424438379810818 still says 1, so running the file twice changes nothing more.
-- Not touched: units (箱CTN stays on the GD line / reservation / movements - the twin cleanup is the AutoCount sync fix), the
-- invoice, the reorder Redis counter (5 packets high, alert cache only). Run in one transaction.

-- 0. preview: the movement marker (1 = not yet fixed), the balances, the FIFO layer, the GD line
SELECT 'marker movement' AS what, CAST(m.base_qty AS CHAR) AS v FROM inventory_movement m WHERE m.id = 2113424438379810818
UNION ALL SELECT 'item_balance unrestricted / total', CONCAT(b.unrestricted_qty, ' / ', b.balance_quantity) FROM item_balance b WHERE b.id = 2113416533920321537
UNION ALL SELECT 'item_batch_balance unrestricted / total', CONCAT(bb.unrestricted_qty, ' / ', bb.balance_quantity) FROM item_batch_balance bb WHERE bb.id = 2113416533807075329
UNION ALL SELECT 'fifo available', CAST(f.fifo_available_quantity AS CHAR) FROM fifo_costing_history f WHERE f.id = 2113416534125842434
UNION ALL SELECT 'GD line base_qty', CAST(l.base_qty AS CHAR) FROM goods_delivery_fwii8mvb_sub l WHERE l.id = 2113424421384491010;

START TRANSACTION;

-- 1. Tingkat 2-S7-L balances
UPDATE item_balance
   SET unrestricted_qty = unrestricted_qty - 5, balance_quantity = balance_quantity - 5
 WHERE id = 2113416533920321537 AND tenant_id = '128671' AND material_id = 2113379350937214980 AND unrestricted_qty >= 5
   AND (SELECT m.base_qty FROM inventory_movement m WHERE m.id = 2113424438379810818) = 1;

UPDATE item_batch_balance
   SET unrestricted_qty = unrestricted_qty - 5, balance_quantity = balance_quantity - 5
 WHERE id = 2113416533807075329 AND tenant_id = '128671' AND material_id = 2113379350937214980 AND batch_id = 2113416533530251266
   AND unrestricted_qty >= 5
   AND (SELECT m.base_qty FROM inventory_movement m WHERE m.id = 2113424438379810818) = 1;

-- 2. the batch's FIFO layer
UPDATE fifo_costing_history
   SET fifo_available_quantity = fifo_available_quantity - 5
 WHERE id = 2113416534125842434 AND tenant_id = '128671' AND material_id = 2113379350937214980 AND fifo_available_quantity >= 5
   AND (SELECT m.base_qty FROM inventory_movement m WHERE m.id = 2113424438379810818) = 1;

-- 3. GD-2610-971's noodle line
UPDATE goods_delivery_fwii8mvb_sub
   SET base_qty = 6
 WHERE id = 2113424421384491010 AND tenant_id = '128671' AND material_id = 2113379350937214980 AND base_qty = 1;

-- 4. its 5 movements (last: the marker)
UPDATE inventory_movement
   SET base_qty = 6, actual_base_qty = actual_base_qty * 6
 WHERE tenant_id = '128671' AND trx_no = 'GD-2610-971' AND item_id = 2113379350937214980 AND base_qty = 1
   AND id IN (2113424438379810818, 2113424439755542529, 2113451100295270402, 2113451102652469250, 2113452074153938945);

COMMIT;

-- 5. check: rerun the preview - marker 6, balances and FIFO 5 lower than before, GD line 6.
--    Each UPDATE above should report: 1, 1, 1, 1, 5 rows.
