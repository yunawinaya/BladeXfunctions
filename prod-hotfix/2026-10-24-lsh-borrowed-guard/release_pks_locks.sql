-- LSH (128671): stock locks leaked by PACKING_SAVE v31's "borrowed guard" (owner PKS|<28 hex>, COST keys). A Packing save
-- that crashed in its GOODS_DELIVERY child (GD_UNUSED_FN_NEW v52 code_node_BGscope throws "borrowed guard batch refused"
-- on any non-200 batch) never released them, and the lock table has no expiry. The V2 engines claim the same COST keys,
-- so GD V2 jobs on those items wait on LOCK_BUSY and then fail. Run AFTER the PACKING_SAVE revert (no new PKS locks).
-- claimed_at / last_released_at are TIMESTAMP columns: compare and write them with NOW() (right in any session time zone);
-- update_time is DATETIME, the platform's UTC+8.

-- 1. preview: 2026-10-24 11:25 MYT there were 22 keys under 7 owners (claimed 11:09 - 11:19 MYT)
SELECT CAST(id AS CHAR) AS id, lock_key, owner_operation_id, claimed_at, lock_version
  FROM inventory_balance_lock
 WHERE tenant_id = '128671' AND is_deleted = 0 AND balance_type = 'COST' AND free_token = 0
   AND owner_operation_id LIKE 'PKS|%' AND claimed_at < NOW() - INTERVAL 5 MINUTE
 ORDER BY claimed_at;

-- 2. release, as the guard's own release does (PGabortRelease + give): owner kept as last owner, cleared, released now,
--    version + 1, token back. MySQL assigns left to right: last_owner_operation_id must come before owner_operation_id.
UPDATE inventory_balance_lock
   SET last_owner_operation_id = owner_operation_id,
       owner_operation_id = '',
       last_released_at = NOW(),
       lock_version = lock_version + 1,
       free_token = 1,
       update_time = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '128671' AND is_deleted = 0 AND balance_type = 'COST' AND free_token = 0
   AND owner_operation_id LIKE 'PKS|%' AND claimed_at < NOW() - INTERVAL 5 MINUTE;

-- 3. check: expect 0
SELECT COUNT(*) AS pks_still_held FROM inventory_balance_lock
 WHERE tenant_id = '128671' AND is_deleted = 0 AND free_token = 0 AND owner_operation_id LIKE 'PKS|%';
