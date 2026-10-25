-- Resume the three LSH GD cancels held at X5_NUMBERS on 2026-10-25 (GD-2610-1310 / 1308 / 1305).
-- Run ONLY after GD_CANCEL_COMMIT (shared-Picking fix) and GD_CANCEL_WORKER (240 s budget) are enabled on prod.
--
-- What they already did (DONE step rows, NOT repeated - the commit skips DONE steps):
--   X0_REVALIDATE, X2_INVENTORY (stock released), X3_RESERVATIONS (reservations cancelled), X4_SO (SO lines / headers).
-- What is left: X5_NUMBERS (now per-token on the shared Picking headers), X6_GD (the GD Cancelled, no longer Processing),
-- X7 (item dates, reorder). X4P / X4K / X4H had nothing to do (Completed Pickings / Packings stay as they are).
--
-- The worker's claim gate is the step row W0_CLAIM_<row_version>; only W0_CLAIM_0 exists, so row_version + 1 (6 -> 7) opens a
-- fresh gate.

UPDATE gd_async_job
   SET job_status       = 'COMMITTING_GD',
       progress_percent = 70,
       progress_message = 'Cancelling the delivery (resumed after the shared-Picking fix)',
       attempt_count    = 0,
       next_attempt_at  = NULL,
       lease_owner      = NULL,
       lease_expires_at = NULL,
       error_code       = NULL,
       error_message    = NULL,
       error_details    = NULL,
       finished_at      = NULL,
       row_version      = row_version + 1,
       update_time      = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)
 WHERE tenant_id  = '128671'
   AND id IN (2114178476813717505, 2114178499131609090, 2114178532597960706)
   AND command    = 'CANCEL_GD'
   AND job_status = 'REQUIRES_REVIEW'
   AND error_code = 'GDX_RECONCILIATION_MISMATCH';
-- expect: 3 rows affected

-- Then open the LSH GD list once: its mount kicks GD_CANCEL_WORKER, which now resumes all three in one run.
-- Check (read-only):
-- SELECT CAST(j.id AS CHAR) id, j.job_status, j.error_code, g.delivery_no, g.gd_status
--   FROM gd_async_job j JOIN goods_delivery g ON g.tenant_id = j.tenant_id
--    AND CAST(g.id AS CHAR) COLLATE utf8mb4_general_ci = SUBSTRING(j.correlation_id, 4) COLLATE utf8mb4_general_ci
--  WHERE j.tenant_id = '128671' AND j.id IN (2114178476813717505, 2114178499131609090, 2114178532597960706);
-- expect: COMPLETED, GD-2610-1310-Cancelled / 1308-Cancelled / 1305-Cancelled, gd_status Cancelled.
