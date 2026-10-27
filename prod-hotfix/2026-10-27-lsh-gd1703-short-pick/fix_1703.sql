-- LSH (128671), 10-27: GD-2610-1703 (id 2114960607185866754) is fully picked but can never auto-complete.
-- PI-2610-3917 (phone, classic, kuber 14:43:07) recorded 1.008 picked against 24 on line 4 (Button Mushroom 425g/24can/ctn,
-- Lot 5-A, batch 1058-074-0001) and still closed the Picking Completed: the phone took "1" as 1 can -> 0.042 ctn (1/24
-- rounded) -> 1.008 cans. LSH confirms all 24 were picked (user, 16:10).
-- Line 4 stays In Progress, so the header stays In Progress, so neither the classic nor the V2 auto-complete fires.
-- The allocation is intact (temp_qty_data 24, on_reserved_gd 24 Allocated, same bin + batch): only the picked fields carry
-- 1.008. The fix writes them the way the classic confirm wrote line 1 (12 of 12, 14:44:44); then the GD is completed from
-- the GD form, which moves the stock.

-- ===== PART 1: preview (read-only). Each result must match the line above it. =====

-- record: store_out_qty 1.00800000, picked_qty_alt 0.04200000
SELECT CAST(id AS CHAR) AS id, gd_line_id, store_out_qty, picked_qty_alt, confirmed_by, confirmed_at
  FROM transfer_order_vrqs3cmr_sub
 WHERE tenant_id = '128671' AND id = 2114971136054923266 AND is_deleted = 0;

-- lines: 1-3 Completed, 4 In Progress with picked_qty 1.00800000, gd_qty 24
SELECT line_index, CAST(id AS CHAR) AS id, gd_qty, picking_status, picked_qty, picked_view_stock, picked_temp_qty_data
  FROM goods_delivery_fwii8mvb_sub
 WHERE tenant_id = '128671' AND goods_delivery_id = '2114960607185866754' AND is_deleted = 0
 ORDER BY line_index;

-- header: GD-2610-1703, Created, In Progress
SELECT delivery_no, gd_status, picking_status, update_time
  FROM goods_delivery
 WHERE tenant_id = '128671' AND id = 2114960607185866754 AND is_deleted = 0;

-- reservation: line 4 = one row, Allocated 24 (unchanged by the fix)
SELECT CAST(id AS CHAR) AS id, status, reserved_qty, open_qty, delivered_qty
  FROM on_reserved_gd
 WHERE tenant_id = '128671' AND doc_line_id = '2114960607475273732' AND is_deleted = 0;

-- ===== PART 2: the fix. One statement at a time; each must report exactly 1 row affected. =====

-- 1. the Picking record: 24 picked (1 ctn), as line 1's record holds 12 (1 ctn): expect 1 row
UPDATE transfer_order_vrqs3cmr_sub
   SET store_out_qty = 24,
       picked_qty_alt = 1,
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '128671'
   AND id = 2114971136054923266
   AND gd_line_id = '2114960607475273732'
   AND store_out_qty = 1.008
   AND picked_qty_alt = 0.042
   AND is_deleted = 0;

-- 2. GD line 4: Completed, picked 24: expect 1 row
UPDATE goods_delivery_fwii8mvb_sub
   SET picking_status = 'Completed',
       picked_qty = 24,
       picked_view_stock = REPLACE(picked_view_stock, '1.008', '24'),
       picked_temp_qty_data = REPLACE(picked_temp_qty_data, '"gd_quantity":1.008', '"gd_quantity":24'),
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '128671'
   AND id = 2114960607475273732
   AND goods_delivery_id = '2114960607185866754'
   AND picking_status = 'In Progress'
   AND picked_qty = 1.008
   AND gd_qty = 24
   AND picked_temp_qty_data LIKE '%"gd_quantity":1.008%'
   AND is_deleted = 0;

-- 3. GD header: picking Completed, only once every line is Completed: expect 1 row
UPDATE goods_delivery
   SET picking_status = 'Completed',
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '128671'
   AND id = 2114960607185866754
   AND delivery_no = 'GD-2610-1703'
   AND gd_status = 'Created'
   AND picking_status = 'In Progress'
   AND is_deleted = 0
   AND NOT EXISTS (SELECT 1 FROM goods_delivery_fwii8mvb_sub l
                    WHERE l.tenant_id = '128671' AND l.goods_delivery_id = '2114960607185866754'
                      AND l.is_deleted = 0 AND l.picking_status <> 'Completed');

-- ===== PART 3: checks (read-only) =====

-- record 24 / 1; line 4 Completed 24 ("Total: 24 PCS ... Lot 5-A: 24 PCS", "gd_quantity":24); header Created / Completed
SELECT store_out_qty, picked_qty_alt FROM transfer_order_vrqs3cmr_sub WHERE tenant_id = '128671' AND id = 2114971136054923266;
SELECT picking_status, picked_qty, picked_view_stock, picked_temp_qty_data
  FROM goods_delivery_fwii8mvb_sub WHERE tenant_id = '128671' AND id = 2114960607475273732;
SELECT gd_status, picking_status FROM goods_delivery WHERE tenant_id = '128671' AND id = 2114960607185866754;

-- ===== PART 4: complete the GD (not SQL) =====
-- Open GD-2610-1703 in the GD form and complete it (Completed). That posts the 4 lines' stock out the normal way.
-- Tell me when done and I'll verify the GD, its stock and the SO lines.
