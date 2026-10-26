-- Prod 2026-10-26, Kenhin (tenant 528521): GD/20261026/2097 stuck in Processing after the bulk Complete.
-- Its GD_COMPLETE_COMMIT (run 2114627618249773057, 15:58:06) applied the stock (INVENTORY_BULK_APPLY "Applied 2
-- movements", key GDC|2114627596435197954), then crashed: a nested INVENTORY_LOCK_SEED twin insert (another of the 7
-- completions seeded the same COST key at the same moment) failed the caller. The dead run keeps the job's 30-minute
-- lease until 16:28. Ending it now lets GD_COMPLETE_WORKER re-run the COMMIT on its next kick: the stock call replays
-- (no second issue), then the delivery, reservations and Sales Invoice (auto_si_confirmed true) are written.

-- 0. preview (expect 1 row: COMMITTING_GD, lease_expires_at 2026-10-26 08:28:07 - the session clock is UTC)
SELECT id, job_status, attempt_count, lease_owner, lease_expires_at, NOW(3) AS db_now
  FROM gd_async_job
 WHERE tenant_id = '528521' AND id = 2114627596435197954;

-- 1. end the dead lease (expect 1 row)
UPDATE gd_async_job
   SET lease_expires_at = NOW(3) - INTERVAL 1 SECOND
 WHERE tenant_id = '528521' AND id = 2114627596435197954
   AND job_status = 'COMMITTING_GD' AND lease_expires_at > NOW(3);

-- 2. then open (or refresh) the Goods Delivery list: it kicks the worker on open and every 2 minutes. The worker takes the
--    job from 16:08 (10 minutes after the crashed run's claim). Expect GD/20261026/2097 Completed with its Sales Invoice.
