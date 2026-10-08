-- R3  BUG-006  Force Complete flipped a line on a Cancelled Picking (Kenhin, tenant 528521)
-- ---------------------------------------------------------------------------------------------
-- GD/20261008/1483's Force Complete (2026-10-08 13:19:09) set one line of
-- PI-20261008-0200-Cancelled to "Completed" with 0 picked. Every other line of that Cancelled
-- Picking is still "Open", which is what this line was before. Restores "Open".
-- Run in Bytebase on PROD with backup ON.
-- ---------------------------------------------------------------------------------------------

-- BEFORE (expect 1 row: line_status Completed, picked_qty 0, to_status Cancelled)
SELECT s.id, t.to_id, t.to_status, s.gd_id, s.line_status, s.picked_qty, s.update_time
FROM transfer_order_jz8m9w3h_sub s
JOIN transfer_order t ON t.id = s.transfer_order_id
WHERE s.id = 2108048477970894850 AND s.is_deleted = 0;

-- FIX (expect 1 row affected)
UPDATE transfer_order_jz8m9w3h_sub s
JOIN transfer_order t ON t.id = s.transfer_order_id
SET s.line_status = 'Open'
WHERE s.id = 2108048477970894850
  AND s.tenant_id = '528521'
  AND s.is_deleted = 0
  AND s.line_status = 'Completed'
  AND s.picked_qty = 0
  AND t.to_status = 'Cancelled';

-- AFTER (expect 62 lines, all Open)
SELECT line_status, COUNT(*) FROM transfer_order_jz8m9w3h_sub
WHERE transfer_order_id = 2108048477744402433 AND is_deleted = 0 GROUP BY line_status;
