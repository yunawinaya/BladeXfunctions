-- Prod repair 2026-10-24, tenant 128671 (LSH): close the GD Created V2 job of GD-2610-1250 (job 2113803489355370498).
-- Someone started a manual recovery of it at 11:02:56 and did not finish (nobody claims it; the user said "fix them"):
--   - the SO projection was applied by hand: SO2610-1644 line 2113802891444756483 planned_qty 0 -> 1 (= the GD's quantity; the
--     only delivery on that line);
--   - the Picking event was confirmed READY;
--   - the job was left REQUIRES_REVIEW with the note error_details {"stage": "AWAITING_REORDER_RECEIPT", "recovery":
--     "GD1250_20261024", ...}, and its P7E_REORDER step row says "Run 03-reorder-request.json ONCE after this transaction
--     commits". That request file is not on this machine, so the reorder tracking (Redis) is skipped, as for the 5 in
--     finish_5_handpicked.sql.
-- The delivery is consistent: picked and packed by hand (09:33), its line's allocation matches its open reservation on the box.
-- What is left: the job GD_COMMITTED, so the Picking consumer closes it the usual LSH way (NO_PICK: job COMPLETED, event DONE).
-- This clears the hand-written note. Re-checked when it runs; a second run changes nothing.

-- 0. preview (expect: planned_qty 1, gd_qty 1, open GDs on the line 1; job REQUIRES_REVIEW, event READY)
SELECT sl.planned_qty, l.gd_qty,
       (SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub l2 JOIN goods_delivery g2 ON g2.id = l2.goods_delivery_id AND g2.is_deleted = 0
         WHERE l2.is_deleted = 0 AND l2.so_line_item_id = '2113802891444756483' AND g2.gd_status IN ('Created', 'Processing')) AS open_gds_on_line,
       j.job_status, j.error_code, o.dispatch_status
  FROM gd_async_job j
  JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = 2113803500109565953 AND l.is_deleted = 0
  JOIN sales_order_axszx8cj_sub sl ON sl.id = 2113802891444756483
  LEFT JOIN gd_outbox o ON o.tenant_id = j.tenant_id AND o.job_id = '2113803489355370498' AND o.is_deleted = 0
 WHERE j.tenant_id = '128671' AND j.id = 2113803489355370498;

START TRANSACTION;

-- 1. the job GD_COMMITTED (expect 1)
UPDATE gd_async_job j
   SET j.job_status = 'GD_COMMITTED', j.progress_percent = 85, j.progress_message = CONCAT('GD ', j.gd_no, ' created'),
       j.gd_committed_at = UTC_TIMESTAMP(), j.finished_at = NULL, j.error_code = NULL, j.error_message = NULL, j.error_details = NULL,
       j.lease_owner = NULL, j.lease_expires_at = NULL, j.next_attempt_at = NULL, j.row_version = j.row_version + 1
 WHERE j.tenant_id = '128671' AND j.is_deleted = 0 AND j.command = 'CREATE_GD_FROM_FORM' AND j.id = 2113803489355370498
   AND j.job_status = 'REQUIRES_REVIEW' AND j.error_code = 'GD_PUBLISH_AFTER_INVENTORY_FAILED'
   AND (SELECT sl.planned_qty FROM sales_order_axszx8cj_sub sl WHERE sl.id = 2113802891444756483) = 1;

COMMIT;

-- 2. check: refresh the GD list once (it kicks the consumer). Within a minute the job reads COMPLETED and the event DONE; then
--    GD-2610-1250 can be completed as usual.
