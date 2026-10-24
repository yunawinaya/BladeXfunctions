-- Prod repair 2026-10-24, tenant 128671 (LSH): resume 19 GD Created V2 jobs stuck in REQUIRES_REVIEW at P7B_SO_PROJECTION.
-- Why stuck: their SO lines had a blank planned_qty, which GD_BULK_COMMIT v21 counted as "moved" (fixed by v22, 10:52). Then
-- PACKING_SAVE v31's guard overwrote their step rows (PACKING_DONE ...), so they cannot simply be retried.
-- GDs (GD-2610-): 1212, 1221, 1224, 1226, 1232, 1241, 1237, 1244, 1243, 1258, 1263, 1269, 1270, 1273, 1274, 1279, 1282, 1281, 1290
-- State checked 11:37 MYT: every job reached P7B_SO_PROJECTION, so every earlier step was DONE; the Picking event is READY
-- (P7C done); each SO line still lacks this GD's quantity (planned = open GDs without it), so the fresh projection adds it.
-- This sets their step rows back to DONE, keeps the review row as history under P7B_SO_PROJECTION_R1024 (so COMMIT plans the
-- projection afresh, which v22 writes), and puts each job back to COMMITTING_GD, due now, with a row_version past its
-- claims. The next worker kick (a GD save, or opening the GD list) finishes them: SO planned_qty, job GD_COMMITTED, then
-- the Picking consumer. Not included: GD-2610-1250 (someone's manual recovery, stage AWAITING_REORDER_RECEIPT), GD-2610-1254
-- / 1256 (already moved on). Re-checked when it runs; a second run changes nothing.

-- 0. preview: the 19 jobs as they are now (expect 19 rows, REQUIRES_REVIEW / GD_PUBLISH_AFTER_INVENTORY_FAILED)
SELECT j.gd_no, j.job_status, j.error_code, j.row_version,
       (SELECT COUNT(*) FROM gd_publish_step p WHERE p.tenant_id = '128671' AND p.job_id = CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci
           AND p.is_deleted = 0 AND (p.step_status, p.error_code) IN (('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'), ('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'))) AS overwritten_steps
  FROM gd_async_job j
 WHERE j.tenant_id = '128671' AND j.id IN (2113770906181570561, 2113776365168889858, 2113778206212493314, 2113780636912324609, 2113800782158630913, 2113800788991152130, 2113800796075331585, 2113801425590030338, 2113801426940596226, 2113805489241460738, 2113805682359799810, 2113807323003752450, 2113810234467291137, 2113811091694948353, 2113811095209775105, 2113814726516543489, 2113815322581667841, 2113815324041285633, 2113825905267838978)
 ORDER BY j.id;

START TRANSACTION;

-- 1. every step row but the SO projection's: DONE (expect 179 rows)
UPDATE gd_publish_step p
   SET p.step_status = 'DONE', p.error_code = NULL
 WHERE p.tenant_id = '128671' AND p.is_deleted = 0
   AND p.job_id IN ('2113770906181570561', '2113776365168889858', '2113778206212493314', '2113780636912324609', '2113800782158630913', '2113800788991152130', '2113800796075331585', '2113801425590030338', '2113801426940596226', '2113805489241460738', '2113805682359799810', '2113807323003752450', '2113810234467291137', '2113811091694948353', '2113811095209775105', '2113814726516543489', '2113815322581667841', '2113815324041285633', '2113825905267838978')
   AND p.step_name <> 'P7B_SO_PROJECTION'
   AND (p.step_status, p.error_code) IN (('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'), ('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'))
   AND (SELECT j.job_status FROM gd_async_job j WHERE j.tenant_id = '128671' AND CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci = p.job_id) = 'REQUIRES_REVIEW';

-- 2. the review row: kept as history under another name, so COMMIT plans the projection afresh (expect 19 rows)
UPDATE gd_publish_step p
   SET p.step_name = 'P7B_SO_PROJECTION_R1024', p.step_status = 'REQUIRES_REVIEW', p.error_code = 'GD_PUBLISH_AFTER_INVENTORY_FAILED'
 WHERE p.tenant_id = '128671' AND p.is_deleted = 0
   AND p.job_id IN ('2113770906181570561', '2113776365168889858', '2113778206212493314', '2113780636912324609', '2113800782158630913', '2113800788991152130', '2113800796075331585', '2113801425590030338', '2113801426940596226', '2113805489241460738', '2113805682359799810', '2113807323003752450', '2113810234467291137', '2113811091694948353', '2113811095209775105', '2113814726516543489', '2113815322581667841', '2113815324041285633', '2113825905267838978')
   AND p.step_name = 'P7B_SO_PROJECTION'
   AND (p.step_status, p.error_code) IN (('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'), ('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'));

-- 3. the jobs: COMMITTING_GD, due now, no lease, row_version past every W0 claim of the job (expect 19 rows)
UPDATE gd_async_job j
   SET j.row_version = GREATEST(j.row_version,
                                IFNULL((SELECT MAX(CAST(SUBSTRING(p.step_name, 10) AS UNSIGNED)) FROM gd_publish_step p
                                         WHERE p.tenant_id = '128671' AND p.job_id = CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci
                                           AND p.step_name LIKE 'W0\_CLAIM\_%'), 0)) + 1,
       j.job_status = 'COMMITTING_GD', j.error_code = NULL, j.error_message = NULL, j.error_details = NULL,
       j.lease_owner = NULL, j.lease_expires_at = NULL, j.next_attempt_at = NULL
 WHERE j.tenant_id = '128671' AND j.is_deleted = 0 AND j.command = 'CREATE_GD_FROM_FORM'
   AND j.id IN (2113770906181570561, 2113776365168889858, 2113778206212493314, 2113780636912324609, 2113800782158630913, 2113800788991152130, 2113800796075331585, 2113801425590030338, 2113801426940596226, 2113805489241460738, 2113805682359799810, 2113807323003752450, 2113810234467291137, 2113811091694948353, 2113811095209775105, 2113814726516543489, 2113815322581667841, 2113815324041285633, 2113825905267838978)
   AND j.job_status = 'REQUIRES_REVIEW' AND j.error_code = 'GD_PUBLISH_AFTER_INVENTORY_FAILED';

COMMIT;

-- 4. check: preview 0 shows COMMITTING_GD and overwritten_steps 0. Within minutes of the next worker kick each job should
--    read GD_COMMITTED, then COMPLETED; bladexfunctions-22 checks the SO lines and the events.
