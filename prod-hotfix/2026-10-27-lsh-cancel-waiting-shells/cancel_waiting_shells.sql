-- LSH (tenant 128671) turned packing off on 10-27 12:18 MYT (packing_setup.packing_required = 0 on all 3 rows), so Picking
-- never fills its GD Created V2 shells: cancel the empty "Waiting" ones (packing_status only, as GD Cancel V2's X4K writes it;
-- the deliveries stay as they are). A shell is cancelled only if: "Waiting", the save-time key PKG|<gd_id>, not open in the
-- form, no item / HU-source / HU row, and no background job is open on its delivery.
-- Run the whole file once. Three results: KEEP the first one.
-- prod datetimes are MYT wall-clock read in a UTC session (packing_lock_expires_at is a TIMESTAMP column)
SET time_zone = '+00:00';

-- 1. The shells about to be cancelled. KEEP THIS RESULT: its ids are the undo list.
SELECT CAST(p.id AS CHAR) AS id, p.packing_no, p.gd_no, p.create_time
  FROM packing p
 WHERE p.tenant_id = '128671'
   AND p.is_deleted = 0
   AND p.packing_status = 'Waiting'
   AND p.idempotency_key = CONCAT('PKG|', p.gd_id)
   AND (p.packing_lock_expires_at IS NULL OR p.packing_lock_expires_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))
   AND COALESCE(p.packing_lock_session_id, '') NOT LIKE 'PKGJOB-%'
   AND p.id NOT IN (SELECT pid FROM (
         SELECT packing_id AS pid FROM packing_jz8m9w3h_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL
         UNION SELECT packing_id FROM packing_mudjw4xk_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL
         UNION SELECT packing_id FROM packing_hr4nq20g_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL) AS has_rows)
   AND p.gd_id NOT IN (SELECT gid FROM (
         SELECT SUBSTRING(correlation_id, 4) AS gid FROM gd_async_job
          WHERE tenant_id = '128671' AND is_deleted = 0 AND correlation_id LIKE 'GD|%'
            AND job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')) AS busy)
 ORDER BY p.packing_no;

-- 2. Cancel them. Every condition is checked again here.
UPDATE packing p
   SET p.packing_status = 'Cancelled',
       p.update_time = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)
 WHERE p.tenant_id = '128671'
   AND p.is_deleted = 0
   AND p.packing_status = 'Waiting'
   AND p.idempotency_key = CONCAT('PKG|', p.gd_id)
   AND (p.packing_lock_expires_at IS NULL OR p.packing_lock_expires_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))
   AND COALESCE(p.packing_lock_session_id, '') NOT LIKE 'PKGJOB-%'
   AND p.id NOT IN (SELECT pid FROM (
         SELECT packing_id AS pid FROM packing_jz8m9w3h_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL
         UNION SELECT packing_id FROM packing_mudjw4xk_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL
         UNION SELECT packing_id FROM packing_hr4nq20g_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL) AS has_rows)
   AND p.gd_id NOT IN (SELECT gid FROM (
         SELECT SUBSTRING(correlation_id, 4) AS gid FROM gd_async_job
          WHERE tenant_id = '128671' AND is_deleted = 0 AND correlation_id LIKE 'GD|%'
            AND job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')) AS busy);

-- 3. Check: expect 0 rows.
SELECT CAST(p.id AS CHAR) AS id, p.packing_no, p.gd_no, p.create_time
  FROM packing p
 WHERE p.tenant_id = '128671'
   AND p.is_deleted = 0
   AND p.packing_status = 'Waiting'
   AND p.idempotency_key = CONCAT('PKG|', p.gd_id)
   AND (p.packing_lock_expires_at IS NULL OR p.packing_lock_expires_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))
   AND COALESCE(p.packing_lock_session_id, '') NOT LIKE 'PKGJOB-%'
   AND p.id NOT IN (SELECT pid FROM (
         SELECT packing_id AS pid FROM packing_jz8m9w3h_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL
         UNION SELECT packing_id FROM packing_mudjw4xk_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL
         UNION SELECT packing_id FROM packing_hr4nq20g_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL) AS has_rows)
   AND p.gd_id NOT IN (SELECT gid FROM (
         SELECT SUBSTRING(correlation_id, 4) AS gid FROM gd_async_job
          WHERE tenant_id = '128671' AND is_deleted = 0 AND correlation_id LIKE 'GD|%'
            AND job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')) AS busy)
 ORDER BY p.packing_no;

-- Undo (only if needed), with the ids from step 1:
-- UPDATE packing SET packing_status = 'Waiting' WHERE tenant_id = '128671' AND packing_status = 'Cancelled' AND id IN (<ids from step 1>);
