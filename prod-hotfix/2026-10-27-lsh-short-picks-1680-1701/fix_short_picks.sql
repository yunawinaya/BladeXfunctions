-- LSH (128671), 10-27: kuber's phone confirm of PI-2610-4015 (15:48:44) recorded 1 of 2 on two lines, and the Picking
-- closed Completed. LSH confirms 2 of each were picked (user, 17:00):
--   GD-2610-1680 (id 2114954329474600962) line 20, Extra Fine Salt, Lot 5-A, batch 1067-002-0001
--   GD-2610-1701 (id 2114960606447669250) line 6,  Button Mushroom, Lot 5-A, batch 1058-074-0001
-- Left as is, both lines stay In Progress, so when the GDs' last Pickings close (PI-2610-4009 / 4013, still Created at 17:00)
-- the header never rolls up to Completed and Auto Complete GD never fires (the GD-2610-1703 case).
-- Fixed now, while those Pickings are open, the last confirm completes both GDs on its own.
-- Allocation untouched: temp_qty_data 2 and on_reserved_gd 2 Allocated on the same bin + batch. Only the picked fields
-- carry 1. Same columns the 1703 fix wrote (prod-hotfix/2026-10-27-lsh-gd1703-short-pick/fix_1703.sql).

-- ===== PART 1: preview (read-only). Each result must match the line above it. =====

-- records: both store_out_qty 1, picked_qty_alt 1
SELECT CAST(id AS CHAR) AS id, gd_line_id, store_out_qty, picked_qty_alt, confirmed_by, confirmed_at
  FROM transfer_order_vrqs3cmr_sub
 WHERE tenant_id = '128671' AND id IN (2114987648299962373, 2114987648299962378) AND is_deleted = 0;

-- lines: both gd_qty 2, In Progress, picked_qty 1, "Total: 1 PCS ... Lot 5-A: 1 PCS", "gd_quantity":1
SELECT CAST(id AS CHAR) AS id, goods_delivery_id, line_index, gd_qty, picking_status, picked_qty, picked_view_stock, picked_temp_qty_data
  FROM goods_delivery_fwii8mvb_sub
 WHERE tenant_id = '128671' AND id IN (2114954329575264258, 2114960606682550278) AND is_deleted = 0;

-- reservations: both one row, Allocated 2 (unchanged by the fix)
SELECT doc_line_id, status, reserved_qty, open_qty, delivered_qty
  FROM on_reserved_gd
 WHERE tenant_id = '128671' AND doc_line_id IN ('2114954329575264258', '2114960606682550278') AND is_deleted = 0;

-- ===== PART 2: the fix. One statement at a time; each must report exactly 2 rows affected. =====

-- 1. the two Picking records: 2 picked: expect 2 rows
UPDATE transfer_order_vrqs3cmr_sub
   SET store_out_qty = 2,
       picked_qty_alt = 2,
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '128671'
   AND ((id = 2114987648299962373 AND gd_line_id = '2114954329575264258')
     OR (id = 2114987648299962378 AND gd_line_id = '2114960606682550278'))
   AND store_out_qty = 1
   AND picked_qty_alt = 1
   AND is_deleted = 0;

-- 2. the two GD lines: Completed, picked 2: expect 2 rows
UPDATE goods_delivery_fwii8mvb_sub
   SET picking_status = 'Completed',
       picked_qty = 2,
       picked_view_stock = REPLACE(picked_view_stock, ': 1 PCS', ': 2 PCS'),
       picked_temp_qty_data = REPLACE(picked_temp_qty_data, '"gd_quantity":1,', '"gd_quantity":2,'),
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '128671'
   AND ((id = 2114954329575264258 AND goods_delivery_id = '2114954329474600962')
     OR (id = 2114960606682550278 AND goods_delivery_id = '2114960606447669250'))
   AND picking_status = 'In Progress'
   AND picked_qty = 1
   AND gd_qty = 2
   AND picked_view_stock LIKE '%: 1 PCS%'
   AND picked_temp_qty_data LIKE '%"gd_quantity":1,%'
   AND is_deleted = 0;

-- ===== PART 3: checks (read-only) =====

-- records 2 / 2; lines Completed 2, "Total: 2 PCS ... Lot 5-A: 2 PCS", "gd_quantity":2
SELECT CAST(id AS CHAR) AS id, store_out_qty, picked_qty_alt
  FROM transfer_order_vrqs3cmr_sub WHERE tenant_id = '128671' AND id IN (2114987648299962373, 2114987648299962378);
SELECT CAST(id AS CHAR) AS id, picking_status, picked_qty, picked_view_stock, picked_temp_qty_data
  FROM goods_delivery_fwii8mvb_sub WHERE tenant_id = '128671' AND id IN (2114954329575264258, 2114960606682550278);

-- No GD header write: both GDs still have open Pickings, and the last confirm rolls the header up and auto-completes.
-- If a GD's last Picking closes before PART 2 runs, that GD stops at In Progress: tell me and I'll add the 1703 header step.
