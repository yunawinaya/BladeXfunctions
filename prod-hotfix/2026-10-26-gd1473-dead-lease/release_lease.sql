-- RUN by the user 2026-10-26 17:47:00 MYT. Re-claimed 17:47:57 (attempt 1); the stock applied once (IBA|RUN|002 -> IBA|DONE);
-- COMPLETED 17:48:32 and GD-2610-1473 is Completed. LSH health check after: BALANCE, GD-STOCK and LOCKS OK.
--
-- GD-2610-1473 (LSH, tenant 128671): end the dead lease of COMPLETE_GD job 2114649456480751618, so the next
-- GD_COMPLETE_WORKER tick re-claims it now instead of after 17:55:03 MYT.
--
-- Why it is parked: its worker run 2114649467440467969 (17:24:55 MYT) crashed. Inside GD_COMPLETE_COMMIT's stock step,
-- INVENTORY_BULK_APPLY seeded the lock row COST|2113378775130578954|<plant> at the same moment as another completion and
-- lost on the unique key. The apply caught it and answered LOCK_BUSY, but the caught error still failed the commit and
-- the worker, so the job kept its 30-minute lease.
-- Nothing moved: C0_REVALIDATE and C1_SNAPSHOT are DONE, IBA|RUN|001 is ENDED, and there is no IBA|DONE and no C2 step.
-- The re-claim resumes at the stock step, and the lock row now exists.
--
-- Prod clock is UTC: lease_expires_at 09:55:03 = 17:55:03 MYT.

-- 1. Check: exactly 1 row, lease_owner PUB|f814e7a54f0d47c6ab57914d, lease_expires_at later than db_now.
SELECT CAST(id AS CHAR) AS id, job_status, attempt_count, lease_owner, lease_expires_at, NOW(3) AS db_now
  FROM gd_async_job
 WHERE id = 2114649456480751618 AND tenant_id = '128671';

-- 2. End the lease. Expect: 1 row affected (0 = it already lapsed or was re-claimed: nothing to do).
UPDATE gd_async_job
   SET lease_expires_at = NOW(3)
 WHERE id = 2114649456480751618
   AND tenant_id = '128671'
   AND job_status = 'COMMITTING_GD'
   AND lease_owner = 'PUB|f814e7a54f0d47c6ab57914d'
   AND lease_expires_at > NOW(3);

-- 3. Then open the GD list at LSH (it kicks the workers), or wait up to 2 minutes for one already open.
--    Done when the job reads COMPLETED and GD-2610-1473 reads Completed.
