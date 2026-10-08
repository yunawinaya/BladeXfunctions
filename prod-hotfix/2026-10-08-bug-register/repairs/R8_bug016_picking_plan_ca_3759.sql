-- R8  BUG-016  Picking Plan CA-3759 reopened after Force Complete (TAF, tenant 681409)
-- ---------------------------------------------------------------------------------------------
-- CA-3759 was force-completed 2026-10-02 11:06:47 (PICKING_PLAN run 2105856994664648706) while
-- Picking PK-03780 was open; PK-03780's completion at 11:12:50 re-saved it with the hard-coded
-- saveAs "Created" and reopened it. Its delivery TA188810 has since been Completed, so the plan
-- should read Completed again (otherwise it can be used for another delivery).
-- Checked every TAF plan in Created / In Progress since 09-01: CA-3759 is the only one that was
-- completed and reopened; CA-3893, -3595, -3522, -3274, -3376, -3217 were never completed.
-- Run in Bytebase on PROD with backup ON.
-- ---------------------------------------------------------------------------------------------

-- BEFORE (expect to_status Created, picking_status In Progress)
SELECT id, to_no, to_status, picking_status, update_time FROM picking_plan
WHERE id = 2105180334856474625 AND is_deleted = 0;

-- FIX (expect 1 row affected)
UPDATE picking_plan
SET to_status = 'Completed'
WHERE id = 2105180334856474625 AND tenant_id = '681409' AND is_deleted = 0 AND to_status = 'Created';

-- DETECTION (read-only), worth re-running after deploy:
-- 1) Created GD-from-Picking-Plan whose SO line can no longer cover it (would fail at completion).
--    2026-10-08: one row, tenant 683894 GD/20261002/003 (30 of an SO line already fully delivered,
--    planned 0) -- looks like a duplicate delivery, not BUG-016; please review with the user.
SELECT g.tenant_id, g.delivery_no, g.create_time, l.so_line_item_id, l.gd_qty,
       sol.planned_qty, sol.delivered_qty, sol.so_quantity
FROM goods_delivery g
JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0
JOIN sales_order_axszx8cj_sub sol ON sol.id = l.so_line_item_id AND sol.is_deleted = 0
WHERE g.is_deleted = 0 AND g.gd_status = 'Created' AND g.is_select_picking = 1
  AND l.gd_qty > 0 AND sol.planned_qty + 0.0005 < l.gd_qty
ORDER BY g.tenant_id, g.delivery_no;
