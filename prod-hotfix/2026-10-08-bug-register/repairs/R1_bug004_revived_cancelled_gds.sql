-- R1  BUG-004  Cancelled GDs revived to "Created" by a Packing / Picking re-save
-- ---------------------------------------------------------------------------------------------
-- REPAIR IS DONE IN THE APP, NOT BY SQL. Do it only AFTER GOODS_DELIVERY, PACKING_SAVE and
-- PICKING_LOOP are deployed, otherwise an open Packing / Picking can revive them again.
--
-- Steps: open the Goods Delivery list, select the 7 GDs below (they show status Created), Cancel.
-- The cancel path releases the reservations the revival re-made (Reserved -> Unrestricted) and
-- sets gd_status Cancelled through the normal inventory workflow.
--
-- Why re-cancel is safe (verified 2026-10-08): every SO line of these GDs has planned_qty 0 and no
-- other open GD on it, so the cancel's "planned_qty - gd_qty" clamps at 0 and cannot double-count.
-- Re-run CHECK 2 immediately before cancelling; if any row shows planned_qty > 0 or
-- other_open_qty > 0, STOP and ask -- that GD needs a manual fix instead.
--
-- Known cosmetic side effect: the list page renames inventory_movement trx_no to
-- "<delivery_no>-Cancelled", so this second cancel produces "...-Cancelled-Cancelled" on the
-- movements of these 7 GDs.
--
-- Flag (separate, not repaired here): GD-26/10/0071 also has two on_reserved_gd rows with
-- doc_no GD-26/10/0070 and status Delivered (ids 2106917837279989761, ...762) pointing at its id.
-- ---------------------------------------------------------------------------------------------

-- CHECK 1 (BEFORE: expect exactly these 7 rows, gd_status Created)
--   GD-20260924-182, -198, -199, GD-20260929-258, GD-20260930-287, -288 (128671), GD-26/10/0071 (900938)
SELECT tenant_id, id, delivery_no, gd_status, picking_status, packing_status, update_time
FROM goods_delivery
WHERE is_deleted = 0 AND delivery_no LIKE '%-Cancelled' AND gd_status <> 'Cancelled'
ORDER BY delivery_no;

-- CHECK 2 (BEFORE, re-run right before cancelling: expect planned_qty 0 and other_open_qty 0 on every row)
SELECT g.tenant_id, g.delivery_no, l.so_line_item_id, l.gd_qty, sol.planned_qty, sol.delivered_qty,
       (SELECT COALESCE(SUM(l2.gd_qty), 0)
          FROM goods_delivery_fwii8mvb_sub l2
          JOIN goods_delivery g2 ON g2.id = l2.goods_delivery_id AND g2.is_deleted = 0
         WHERE l2.is_deleted = 0 AND l2.so_line_item_id = l.so_line_item_id
           AND g2.id <> g.id AND g2.gd_status = 'Created') AS other_open_qty
FROM goods_delivery g
JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0
LEFT JOIN sales_order_axszx8cj_sub sol ON sol.id = l.so_line_item_id
WHERE g.is_deleted = 0 AND g.delivery_no LIKE '%-Cancelled' AND g.gd_status <> 'Cancelled'
ORDER BY g.delivery_no;

-- CHECK 3 (BEFORE: expect Allocated rows totalling 182/198/199/258/287/288 = 44/39/21/4/10/50, 0071 = 1)
SELECT g.delivery_no, r.id, r.status, r.open_qty, r.bin_location, r.doc_no
FROM goods_delivery g
JOIN on_reserved_gd r ON r.target_gd_id = g.id AND r.is_deleted = 0 AND r.status = 'Allocated'
WHERE g.is_deleted = 0 AND g.delivery_no LIKE '%-Cancelled' AND g.gd_status <> 'Cancelled'
ORDER BY g.delivery_no, r.id;

-- AFTER re-cancelling: CHECK 1 and CHECK 3 must both return 0 rows.

-- Related (no action needed): open Packings of cancelled GDs. After PACKING_SAVE is deployed they
-- can no longer be completed (they would have revived their GD). Delete them in the app if unwanted.
SELECT g.tenant_id, g.delivery_no, p.packing_no, p.packing_status
FROM packing p
JOIN goods_delivery g ON g.id = p.gd_id AND g.is_deleted = 0
WHERE p.is_deleted = 0 AND g.gd_status = 'Cancelled' AND p.packing_status <> 'Completed'
ORDER BY p.packing_no;
