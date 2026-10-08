-- R6  BUG-015  LOT-08/2026-131 (Ascent, tenant 881544): Draft edited and completed, double-posted
-- ---------------------------------------------------------------------------------------------
-- Same defect as the register's LOT-09/2026-441, on 2026-08-11. Reconcile posted under the
-- placeholder "issued" (Unrestricted OUT at the source, In Transit IN at the destination), then
-- completion posted the real LOT-08/2026-131 OUT/IN. Result: source deducted twice, 1 UNIT
-- stranded In Transit at the destination. No batch rows, no in_transit_detail rows, no costing
-- (location move within one plant).
--
-- The register's two incidents are ALREADY repaired -- do not touch them:
--   LOT-09/2026-441: its "issued" movements are is_deleted = 1 since 2026-10-05 06:21
--   LOT/2610/036:    its 8 movements were re-stamped LOT/2610/036 / Unrestricted 2026-10-07 15:40
--
-- Verified 2026-10-08: movement ledger == item_balance for both bins (source Unrestricted 6;
-- destination Unrestricted 18, In Transit 1). After the fix: source 7, destination In Transit 0.
-- Run in Bytebase on PROD with backup ON.
-- ---------------------------------------------------------------------------------------------

-- BEFORE 1 (expect the 2 "issued" rows live, plus the 2 legitimate LOT-08/2026-131 rows)
SELECT id, trx_no, movement, inventory_category, base_qty, bin_location_id, is_deleted
FROM inventory_movement
WHERE tenant_id = '881544' AND item_id = '2071315826327208003'
  AND id IN (2086997631720099841, 2086997632584126465, 2086997636933619713, 2086997637818617857);

-- BEFORE 2 (expect source 2071323947056345089: unrestricted 6 / balance 6;
--           destination 2071324116472672258: unrestricted 18, intransit 1 / balance 19)
SELECT id, location_id, unrestricted_qty, intransit_qty, reserved_qty, block_qty, qualityinsp_qty, balance_quantity
FROM item_balance
WHERE tenant_id = '881544' AND is_deleted = 0 AND id IN (2071323947056345089, 2071324116472672258);

-- FIX (one statement; expect 4 rows affected: 2 movements + 2 balances).
-- Every guard must hold or nothing changes.
UPDATE inventory_movement m_out
JOIN inventory_movement m_in ON m_in.id = 2086997632584126465
JOIN item_balance src ON src.id = 2071323947056345089
JOIN item_balance dst ON dst.id = 2071324116472672258
SET m_out.is_deleted = 1,
    m_in.is_deleted = 1,
    src.unrestricted_qty = src.unrestricted_qty + 1,
    src.balance_quantity = src.balance_quantity + 1,
    dst.intransit_qty = dst.intransit_qty - 1,
    dst.balance_quantity = dst.balance_quantity - 1
WHERE m_out.id = 2086997631720099841
  AND m_out.tenant_id = '881544' AND m_in.tenant_id = '881544'
  AND src.tenant_id = '881544' AND dst.tenant_id = '881544'
  AND m_out.trx_no = 'issued' AND m_in.trx_no = 'issued'
  AND m_out.is_deleted = 0 AND m_in.is_deleted = 0
  AND m_out.movement = 'OUT' AND m_out.inventory_category = 'Unrestricted' AND m_out.base_qty = 1
  AND m_in.movement = 'IN' AND m_in.inventory_category = 'In Transit' AND m_in.base_qty = 1
  AND src.material_id = '2071315826327208003' AND src.location_id = '2029433911403446274'
  AND dst.material_id = '2071315826327208003' AND dst.location_id = '2070317700337704962'
  AND src.unrestricted_qty = 6 AND src.balance_quantity = 6
  AND dst.intransit_qty = 1 AND dst.balance_quantity = 19;

-- AFTER (expect ledger == balance: source Unrestricted 7; destination Unrestricted 18, In Transit 0)
SELECT bin_location_id, inventory_category,
       SUM(CASE WHEN movement = 'IN' THEN base_qty ELSE -base_qty END) AS ledger
FROM inventory_movement
WHERE tenant_id = '881544' AND is_deleted = 0 AND item_id = '2071315826327208003'
  AND bin_location_id IN ('2029433911403446274', '2070317700337704962')
GROUP BY bin_location_id, inventory_category;
-- then re-run BEFORE 2.
