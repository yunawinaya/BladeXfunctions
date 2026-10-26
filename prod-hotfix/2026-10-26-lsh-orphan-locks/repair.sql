-- 2026-10-26 LSH (128671): release the stock keys of 5 orphaned GD stock operations.
-- See README.md. Prod, run as one block. Expected: 81 rows, then 5 rows.
-- Both statements only touch rows still in the stuck state (owner = the orphan / LOCKING, never mutated),
-- so re-running them, or running them after the system moved on, changes nothing.

START TRANSACTION;

-- 1. The 81 key rows still owned by the orphans -> released, exactly as the engine's own release leaves a row:
--    free_token 1, owner '', last owner = the operation, released now (UTC like the engine's columns).
--    last_owner_operation_id is assigned BEFORE owner_operation_id is cleared (MySQL applies SET left to right).
UPDATE inventory_balance_lock
   SET last_owner_operation_id = owner_operation_id,
       owner_operation_id = '',
       free_token = 1,
       last_released_at = UTC_TIMESTAMP(),
       lock_version = lock_version + 1,
       update_time = DATE_ADD(NOW(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '128671'
   AND is_deleted = 0
   AND free_token = 0
   AND owner_operation_id IN ('GD|2114497026472415234|11',
                              'GD|2114498343626477569|10',
                              'GD|2114499732461195265|3',
                              'GD|2114499739281133569|3',
                              'GD|2114499734252163074|4');
-- expect: 81 rows affected

-- 2. The 5 operations -> REJECTED / LOCK_CONFLICT with the engine's own recovery message (as GD|2114497026472415234|10).
UPDATE inventory_operation
   SET operation_status = 'REJECTED',
       result_code = 'LOCK_CONFLICT',
       result_message = 'Stale LOCKING operation rejected before mutation_started_at; owned locks released',
       row_version = row_version + 1,
       completed_at = UTC_TIMESTAMP(),
       update_time = DATE_ADD(NOW(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '128671'
   AND is_deleted = 0
   AND operation_status = 'LOCKING'
   AND mutation_started_at IS NULL
   AND locked_at IS NULL
   AND operation_id IN ('GD|2114497026472415234|11',
                        'GD|2114498343626477569|10',
                        'GD|2114499732461195265|3',
                        'GD|2114499739281133569|3',
                        'GD|2114499734252163074|4');
-- expect: 5 rows affected

-- If both counts match: COMMIT;   otherwise: ROLLBACK; and tell me the counts.
