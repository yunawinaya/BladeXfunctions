-- Optional, prod 2026-10-23: end the leases of the 7 LSH (128671) GD V2 jobs whose worker run crashed on
-- INV_LOCK_TAKEN_PRECHECK under engine v11, before the v12 + worker v11 paste took effect (crashed runs at 12:26:16-17 and
-- 12:40:02 MYT, all Fail at workflow_node_3ylKUgO3). Without this the leases end by themselves at 12:56 and 13:10 MYT.
-- After it, the next Goods Delivery list open (it kicks the worker) recovers each job: the stale LOCKING operation is rejected
-- (LOCK_CONFLICT) and the job retries with a new operation at once - the same path a natural lease expiry takes, the worker's
-- stale-claim handling included (claims older than 10 minutes: the 12:40 pair become claimable from 12:50).
-- Job times on prod are UTC: UTC_TIMESTAMP, whatever the session time zone of the client running this.

-- 1. preview (7 rows; lease_expires_at still in the future)
SELECT CAST(id AS CHAR) AS id, gd_no, job_status, attempt_count, lease_owner, lease_expires_at, UTC_TIMESTAMP(3) AS utc_now
  FROM gd_async_job
 WHERE tenant_id = '128671'
   AND id IN (2113487054728990721, 2113487059900567554, 2113487077369843713, 2113487080221970434, 2113487081836777473,
              2113490602032238593, 2113490605307990017)
   AND command = 'CREATE_GD_FROM_FORM'
   AND job_status = 'COMMITTING_GD'
   AND lease_expires_at > UTC_TIMESTAMP(3);

-- 2. update (the same rows)
UPDATE gd_async_job
   SET lease_expires_at = UTC_TIMESTAMP(3)
 WHERE tenant_id = '128671'
   AND id IN (2113487054728990721, 2113487059900567554, 2113487077369843713, 2113487080221970434, 2113487081836777473,
              2113490602032238593, 2113490605307990017)
   AND command = 'CREATE_GD_FROM_FORM'
   AND job_status = 'COMMITTING_GD'
   AND lease_expires_at > UTC_TIMESTAMP(3);

-- 3. then open the Goods Delivery list at LSH once (and again after 12:50 for GD-2610-1086 / 1087)
