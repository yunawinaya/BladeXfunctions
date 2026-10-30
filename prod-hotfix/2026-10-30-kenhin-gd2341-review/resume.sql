-- GD/20261030/2341 (Kenhin, tenant 528521): resume COMPLETE_GD job 2116014785236701185 (REQUIRES_REVIEW 10-30 11:50:17 MYT).
--
-- Why it stopped: its stock step (INVENTORY_BULK_APPLY, operation GDC|2116014785236701185) wrote every planned row and the 3
-- movements, then its read-back found V97's WA row 2116017246831546368 at wa_cost_price 51.9481 where the plan said
-- 51.94805345. The V97 repair (11:49:28) stored the cost with 8 decimals; the platform stores Kenhin's 4 when the engine
-- wrote the row. The quantity is right (1,000,999,970 - 12 = 1,000,999,958) and every other planned row matches (checked
-- read-only 12:2x). The run still holds 6 locks (COST + ITEM|bin 501 of S01-01, V97, BM04-10).
--
-- The fix: the stored plan takes the stored cost (its 2 values), the engine's REVIEW marker goes, and the job goes back to
-- COMMITTING_GD with an ended lease (as GD-2610-1473 on 10-26). The next GD_COMPLETE_WORKER tick re-claims it and resumes at
-- the stock step: the engine finds every row at its planned value and the movements written, writes nothing, passes its
-- read-back, then the completion carries on (reservations, SO, Picking, GD) and releases the 6 locks.
-- Prod clock is UTC (NOW(3)).

-- PART 1: checks (all must match)
SELECT job_status, row_version, error_code FROM gd_async_job WHERE id = 2116014785236701185 AND tenant_id = '528521';
--   expect: REQUIRES_REVIEW | 4 | GDC_RECONCILIATION_MISMATCH
SELECT gd_status FROM goods_delivery WHERE id = 2116007652147466242 AND tenant_id = '528521';
--   expect: Processing
SELECT step_name, step_status,
       (LENGTH(result_ref) - LENGTH(REPLACE(result_ref, '"wa_cost_price":51.94805345', ''))) / LENGTH('"wa_cost_price":51.94805345') AS old_cost_n
  FROM gd_publish_step WHERE tenant_id = '528521' AND job_id = 'GDC|2116014785236701185' AND is_deleted = 0 ORDER BY id;
--   expect 3 rows: IBA|RUN|001 ENDED 0 | IBA|I|001 INTENT 2 | IBA|REVIEW REVIEW 0   (no IBA|DONE)
SELECT wa_quantity, wa_cost_price FROM wa_costing_method WHERE id = 2116017246831546368 AND tenant_id = '528521';
--   expect: 1000999958.00000000 | 51.94810000
SELECT COUNT(*) AS locks_held FROM inventory_balance_lock WHERE tenant_id = '528521' AND owner_operation_id = 'GDC|2116014785236701185';
--   expect: 6

-- PART 2: the resume (rows affected: 1, then 1, then 1)
UPDATE gd_publish_step
   SET result_ref = REPLACE(result_ref, '"wa_cost_price":51.94805345', '"wa_cost_price":51.9481')
 WHERE tenant_id = '528521' AND job_id = 'GDC|2116014785236701185' AND step_name = 'IBA|I|001' AND step_status = 'INTENT'
   AND is_deleted = 0 AND result_ref LIKE '%"wa_cost_price":51.94805345%';

UPDATE gd_publish_step
   SET is_deleted = 1
 WHERE tenant_id = '528521' AND job_id = 'GDC|2116014785236701185' AND step_name = 'IBA|REVIEW' AND step_status = 'REVIEW'
   AND is_deleted = 0;

UPDATE gd_async_job
   SET job_status = 'COMMITTING_GD', progress_message = 'Completing', error_code = NULL, error_message = NULL, error_details = NULL,
       finished_at = NULL, next_attempt_at = NULL, lease_owner = 'PUB|review-resume-20261030', lease_expires_at = NOW(3)
 WHERE id = 2116014785236701185 AND tenant_id = '528521' AND job_status = 'REQUIRES_REVIEW' AND row_version = 4;

-- PART 3: then open the GD list at Kenhin (it kicks the workers) or wait up to 2 minutes for an open one.
--   Done when the job reads COMPLETED, GD/20261030/2341 reads Completed and the 6 locks are free:
SELECT job_status, IFNULL(error_code, '') AS error_code, progress_message FROM gd_async_job WHERE id = 2116014785236701185 AND tenant_id = '528521';
SELECT gd_status FROM goods_delivery WHERE id = 2116007652147466242 AND tenant_id = '528521';
SELECT COUNT(*) AS locks_held FROM inventory_balance_lock WHERE tenant_id = '528521' AND owner_operation_id = 'GDC|2116014785236701185';
