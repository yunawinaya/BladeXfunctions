-- LSH (128671) SO2610-1604: ATC_SYNC_SO (AutoCount SO sync) read the SO at ~15:20:32.4, before GD Created V2's
-- P7B_SO_PROJECTION stamped it (15:20:32.61-33.07: lines planned 0 -> 6 / 0 -> 3, header gd_status -> Created), so its
-- "gd_status != null -> skip" guard did not skip, and its update (~15:20:33.5) rewrote table_so with planned_qty 0
-- (hard-coded in its line mapper). GD-2610-1151 (Created, 6 + 3) then cannot complete: "planned quantity would become
-- negative (-6.000)". Restore V2's values (gd_publish_step P7B_SO_PROJECTION result_ref), only while still 0 and nothing
-- delivered. Only SO lines affected in any tenant since the 10-22 cut (checked: planned_qty < open Created-GD qty).

-- 1. preview: expect planned_qty 0 / delivered_qty 0 on both
SELECT CAST(id AS CHAR) AS id, so_quantity, planned_qty, delivered_qty, outstanding_quantity
  FROM sales_order_axszx8cj_sub
 WHERE tenant_id = '128671' AND id IN (2113530692934705155, 2113530692934705156);

-- 2. repair: 1 row each
UPDATE sales_order_axszx8cj_sub SET planned_qty = 6
 WHERE tenant_id = '128671' AND id = 2113530692934705155 AND is_deleted = 0 AND planned_qty = 0 AND delivered_qty = 0;
UPDATE sales_order_axszx8cj_sub SET planned_qty = 3
 WHERE tenant_id = '128671' AND id = 2113530692934705156 AND is_deleted = 0 AND planned_qty = 0 AND delivered_qty = 0;

-- 3. then Complete GD-2610-1151 again (it moves 6 / 3 from planned to delivered)
