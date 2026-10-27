-- LSH (128671), 10-27: release the 48 stock locks held by GD-2610-1869's stock operation GD|2115002387512037378|1
-- (job 2115002387512037378), under review since 16:49:51: VERIFICATION_MISMATCH AFTER_BALANCE_WRITE
-- {"AFTER":30,"BEFORE":0,"SAME":0,"OTHER":2,"MISSING":0}. Its locks block the GD creates behind it (GD-2610-1870 first).
-- The same statement the GD session ran for 1774 (prod-hotfix/2026-10-27-lsh-gd1774-review/release_locks.sql), with the
-- operation id and the counts changed. Any V2 operation re-reads the rows under its own lock and applies its own change,
-- so nothing is computed from a stale value. How 1869 itself is settled (reverse by delta + retry, as for 1774) is a
-- separate step for the GD session.

-- 1. Preview: must return 48 (16 BATCH, 16 ITEM, 16 RESERVATION).
SELECT SUBSTRING_INDEX(lock_key, '|', 1) AS kind, COUNT(*) AS n
  FROM inventory_balance_lock
 WHERE tenant_id = '128671'
   AND owner_operation_id = 'GD|2115002387512037378|1'
   AND free_token = 0
   AND is_deleted = 0
 GROUP BY SUBSTRING_INDEX(lock_key, '|', 1);

-- 2. Release: expect "48 rows affected".
UPDATE inventory_balance_lock
   SET owner_operation_id = '',
       last_owner_operation_id = 'GD|2115002387512037378|1',
       last_released_at = NOW(3),
       lock_version = lock_version + 1,
       free_token = 1,
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '128671'
   AND owner_operation_id = 'GD|2115002387512037378|1'
   AND free_token = 0
   AND is_deleted = 0;

-- 3. Check: must return 0.
SELECT COUNT(*) AS still_held
  FROM inventory_balance_lock
 WHERE tenant_id = '128671'
   AND owner_operation_id = 'GD|2115002387512037378|1'
   AND is_deleted = 0;
