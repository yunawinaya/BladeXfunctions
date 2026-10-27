-- Kenhin (528521), 10-27: release the 12 stock locks held by GD/20261027/2168's stock operation, which is under review.
-- The operation stopped BEFORE its first write (VERIFICATION_MISMATCH: an unlocked classic auto-complete changed 2 of its
-- balance rows under its lock). It wrote nothing: 0 movements; "this run wrote no business row". Its locks block every V2
-- GD of the same items (2166 / 2167 / 2173 / 2175). This mirrors the engine's own release (INVENTORY_OPERATION_RECONCILE
-- releasePlan + INVENTORY_LOCK_TOKENS GIVE): clear the owner, last owner = the operation, last_released_at = DB now (UTC),
-- lock_version + 1, free_token 0 -> 1. The operation and GD 2168's job stay under review (a separate decision).

-- 1. Preview: must return exactly 12 rows (6 ITEM + 6 RESERVATION), all free_token 0.
SELECT CAST(id AS CHAR) AS id, lock_key, free_token, lock_version, owner_operation_id
  FROM inventory_balance_lock
 WHERE tenant_id = '528521'
   AND owner_operation_id = 'GD|2114948162857865218|1'
   AND is_deleted = 0;

-- 2. Release: expect "12 rows affected".
UPDATE inventory_balance_lock
   SET owner_operation_id = '',
       last_owner_operation_id = 'GD|2114948162857865218|1',
       last_released_at = NOW(3),
       lock_version = lock_version + 1,
       free_token = 1,
       update_time = CONVERT_TZ(NOW(3), '+00:00', '+08:00')
 WHERE tenant_id = '528521'
   AND owner_operation_id = 'GD|2114948162857865218|1'
   AND free_token = 0
   AND is_deleted = 0;

-- 3. Check: must return 0 rows.
SELECT COUNT(*) AS still_held
  FROM inventory_balance_lock
 WHERE tenant_id = '528521'
   AND owner_operation_id = 'GD|2114948162857865218|1'
   AND is_deleted = 0;
