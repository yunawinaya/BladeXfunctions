-- LSH (128671), 10-27: release the 90 stock locks held by GD-2610-1774's stock operation GD|2114978878563946498|2, which is
-- under review (VERIFICATION_MISMATCH AFTER_BALANCE_WRITE). Its locks block 17 other GD creates.
-- Safe because its balance write is fully in place: all 60 planned rows still carry its change (42 exactly, 18 with later
-- deliveries / a status move by classic paths on top - those take no locks). Any V2 operation re-reads the rows under its own
-- lock and applies its own change, so nothing is computed from a stale value. How 1774 itself is settled is a separate step.
-- Same statement as the Kenhin release (prod-hotfix/2026-10-27-kenhin-gd2168-review-locks/release_locks.sql).

-- 1. Preview: must return 90 (30 BATCH, 30 ITEM, 30 RESERVATION).
SELECT SUBSTRING_INDEX(lock_key, '|', 1) AS kind, COUNT(*) AS n
  FROM inventory_balance_lock
 WHERE tenant_id = '128671'
   AND owner_operation_id = 'GD|2114978878563946498|2'
   AND free_token = 0
   AND is_deleted = 0
 GROUP BY SUBSTRING_INDEX(lock_key, '|', 1);

-- 2. Release: expect "90 rows affected".
UPDATE inventory_balance_lock
   SET owner_operation_id = '',
       last_owner_operation_id = 'GD|2114978878563946498|2',
       last_released_at = NOW(3),
       lock_version = lock_version + 1,
       free_token = 1,
       update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '128671'
   AND owner_operation_id = 'GD|2114978878563946498|2'
   AND free_token = 0
   AND is_deleted = 0;

-- 3. Check: must return 0.
SELECT COUNT(*) AS still_held
  FROM inventory_balance_lock
 WHERE tenant_id = '128671'
   AND owner_operation_id = 'GD|2114978878563946498|2'
   AND is_deleted = 0;
