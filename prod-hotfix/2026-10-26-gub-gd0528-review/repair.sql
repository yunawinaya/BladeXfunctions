-- 2026-10-26 GUB (900938): finish GD-26/10/0528, held for review only because the engine's after-insert check compared the
-- movement price at 8 decimals (99.93685714) with the stored 4-decimal value (99.9369). The stock WAS applied as planned
-- (item_balance 1979083526128324609: Reserved 44 -> 114, Unrestricted 9076 -> 9006; both movements stored; 7 reservations).
-- Records what a normal completion writes (template: GD|2114524711483478018|1), releases the operation's 8 locks, and re-queues
-- the creation job so the worker publishes the GD (P6-P7: GD Created, SO projection, Picking). Run as ONE block.
-- Every statement re-checks the stuck state, so it changes nothing if run twice or after anything moved.

START TRANSACTION;

-- 1. the 9 effects -> VERIFIED (movement ids on the two stock effects), observed after = planned after
UPDATE inventory_operation_effect
   SET effect_status = 'VERIFIED',
       observed_after_qty = expected_after_qty,
       movement_id = CASE effect_key WHEN '1.1.ITEM.IN' THEN '2114523147138109442' WHEN '1.1.ITEM.OUT' THEN '2114523147138109443' ELSE movement_id END,
       error_code = '', error_message = '',
       update_time = DATE_ADD(NOW(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '900938' AND is_deleted = 0 AND operation_id = 'GD|2114523094264713218|1' AND effect_status = 'UNCERTAIN';
-- expect 9

-- 2. the operation -> DONE / OK (review_reason kept as the record of the false mismatch)
UPDATE inventory_operation
   SET operation_status = 'DONE', result_code = 'OK',
       result_message = '9 effect(s) verified (recorded 2026-10-26 after review: movement price stored at 4 decimals 99.9369 vs plan 99.93685714; balances and movements as planned)',
       review_reference = '', effect_summary = '{"by_status":{"VERIFIED":9},"effect_count":9,"effects":[{"effect_key":"1.1.ITEM.IN","effect_status":"VERIFIED","movement_id":"2114523147138109442"},{"effect_key":"1.1.ITEM.OUT","effect_status":"VERIFIED","movement_id":"2114523147138109443"},{"effect_key":"1.1.RESERVATION.IN","effect_status":"VERIFIED","movement_id":""},{"effect_key":"2.1.RESERVATION.IN","effect_status":"VERIFIED","movement_id":""},{"effect_key":"3.1.RESERVATION.IN","effect_status":"VERIFIED","movement_id":""},{"effect_key":"4.1.RESERVATION.IN","effect_status":"VERIFIED","movement_id":""},{"effect_key":"5.1.RESERVATION.IN","effect_status":"VERIFIED","movement_id":""},{"effect_key":"6.1.RESERVATION.IN","effect_status":"VERIFIED","movement_id":""},{"effect_key":"7.1.RESERVATION.IN","effect_status":"VERIFIED","movement_id":""}]}',
       verified_at = UTC_TIMESTAMP(), completed_at = UTC_TIMESTAMP(), row_version = row_version + 1,
       update_time = DATE_ADD(NOW(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '900938' AND is_deleted = 0 AND operation_id = 'GD|2114523094264713218|1'
   AND operation_status = 'REQUIRES_REVIEW' AND result_code = 'VERIFICATION_MISMATCH';
-- expect 1

-- 3. its 8 locks (ITEM|1979082567809552385|1975932706692059138 + 7 RESERVATION) -> released as the engine leaves a row
UPDATE inventory_balance_lock
   SET last_owner_operation_id = owner_operation_id, owner_operation_id = '', free_token = 1,
       last_released_at = UTC_TIMESTAMP(), lock_version = lock_version + 1,
       update_time = DATE_ADD(NOW(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '900938' AND is_deleted = 0 AND free_token = 0 AND owner_operation_id = 'GD|2114523094264713218|1';
-- expect 8

-- 4. the job's stock step -> DONE / OK
UPDATE gd_publish_step
   SET step_status = 'DONE', result_ref = 'OK', error_code = NULL, error_message = NULL, finished_at = UTC_TIMESTAMP(),
       update_time = DATE_ADD(NOW(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '900938' AND is_deleted = 0 AND job_id = '2114523094264713218' AND step_name = 'P3_INVENTORY_APPLY'
   AND step_status = 'REQUIRES_REVIEW';
-- expect 1

-- 5. the creation job -> back in the publish queue, due now (the worker resumes at P6)
UPDATE gd_async_job
   SET job_status = 'COMMITTING_GD', error_code = NULL, error_message = NULL, error_details = NULL,
       progress_message = 'Publishing Goods Delivery', lease_owner = NULL, lease_expires_at = NULL,
       next_attempt_at = UTC_TIMESTAMP(), finished_at = NULL, row_version = row_version + 1,
       update_time = DATE_ADD(NOW(3), INTERVAL 8 HOUR)
 WHERE tenant_id = '900938' AND is_deleted = 0 AND id = 2114523094264713218
   AND job_status = 'REQUIRES_REVIEW' AND error_code = 'GD_INVENTORY_REQUIRES_REVIEW';
-- expect 1

-- All five counts as expected (9 / 1 / 8 / 1 / 1) -> COMMIT;   otherwise ROLLBACK; and send me the counts.
-- Then open GUB's GD list once: its worker kick publishes the GD within a minute.
