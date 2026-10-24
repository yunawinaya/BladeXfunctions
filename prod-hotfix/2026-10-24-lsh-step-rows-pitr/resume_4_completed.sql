-- Prod repair 2026-10-24, tenant 128671 (LSH): the 4 GD Completed V2 jobs (COMPLETE_GD) whose gd_publish_step rows PACKING_SAVE
-- v31's guard overwrote while they ran (11:13-11:27). Their rows were created after 11:05:59, so the point-in-time copy
-- (copy_back.sql) cannot restore them; the normal statuses are known from the step names.
--   GD-2610-1069 (job 2113832045670174722), GD-2610-1138 (job 2113831088173486082): stock moved at 11:16 / 11:13 (11 / 8 movements,
--     C2 done). They resume at phase B: reservations, handling units, sales orders, the GD -> Completed.
--   GD-2610-1165 (job 2113831074160316417), GD-2610-1088 (job 2113834080440291330): stock not moved (C0 + C1 done, C2 waited on the
--     locks leaked by the guard, released 11:32). They resume at C2 (the stock engine).
-- Since the overwrite every retry stopped at its first step insert (duplicate C0_REVALIDATE: the "An error occurred" toast on the GD
-- list), writing nothing. The engine finds its rows by name (IBA|DONE = replay its answer), so no stock moves twice.
-- Only rows that still carry the overwrite are changed; a second run changes nothing.

-- 0. preview: the rows that go back, per job (expect 60: 1069 15, 1138 15, 1165 13, 1088 17)
SELECT REPLACE(p.job_id, 'GDC|', '') AS job, CASE
         WHEN p.step_name LIKE 'P|%' THEN 'PAYLOAD'
         WHEN p.step_name LIKE 'IBA|RUN|%' THEN 'ENDED'
         WHEN p.step_name LIKE 'IBA|I|%' THEN 'INTENT'
         ELSE 'DONE' END AS restore_to, COUNT(*) AS step_rows
  FROM gd_publish_step p
 WHERE p.tenant_id = '128671' AND p.is_deleted = 0
   AND p.job_id IN ('2113832045670174722', '2113831088173486082', '2113831074160316417', '2113834080440291330',
                    'GDC|2113832045670174722', 'GDC|2113831088173486082', 'GDC|2113831074160316417', 'GDC|2113834080440291330')
   AND (p.step_status, p.error_code) IN (('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'),
                                         ('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'))
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- 0b. preview: the jobs (all 4 COMMITTING_GD, GD Processing under the job's own lock: lock_mine 1)
SELECT g.delivery_no, CAST(j.id AS CHAR) AS job, j.job_status, j.attempt_count, j.row_version, j.lease_owner, g.gd_status,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GDC|', SUBSTRING(j.correlation_id, 4)) AND p.step_name LIKE 'LOCK|%'
           AND p.is_deleted = 0 ORDER BY p.id DESC LIMIT 1) = j.idempotency_key AS lock_mine
  FROM gd_async_job j
  JOIN goods_delivery g ON g.tenant_id = j.tenant_id AND g.id = CAST(SUBSTRING(j.correlation_id, 4) AS UNSIGNED) AND g.is_deleted = 0
 WHERE j.tenant_id = '128671' AND j.id IN (2113832045670174722, 2113831088173486082, 2113831074160316417, 2113834080440291330);

START TRANSACTION;

-- 1. the step rows back to their normal statuses (expect 60)
UPDATE gd_publish_step p
   SET p.step_status = CASE
         WHEN p.step_name LIKE 'P|%' THEN 'PAYLOAD'
         WHEN p.step_name LIKE 'IBA|RUN|%' THEN 'ENDED'
         WHEN p.step_name LIKE 'IBA|I|%' THEN 'INTENT'
         ELSE 'DONE' END,
       p.error_code = IF(p.step_name LIKE 'IBA|RUN|%', '', NULL)
 WHERE p.tenant_id = '128671' AND p.is_deleted = 0
   AND p.job_id IN ('2113832045670174722', '2113831088173486082', '2113831074160316417', '2113834080440291330',
                    'GDC|2113832045670174722', 'GDC|2113831088173486082', 'GDC|2113831074160316417', 'GDC|2113834080440291330')
   AND (p.step_name LIKE 'P|%' OR p.step_name LIKE 'W0_CLAIM_%' OR p.step_name LIKE 'IBA|%'
        OR p.step_name IN ('C0_REVALIDATE', 'C1_SNAPSHOT', 'C2_INVENTORY'))
   AND (p.step_status, p.error_code) IN (('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'),
                                         ('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'));

-- 2. the jobs due now: the leases of the crashed retries released, the retries the incident used up given back, row_version past
--    every worker claim row (expect 4)
UPDATE gd_async_job j
  JOIN (SELECT p.job_id, MAX(CAST(SUBSTRING(p.step_name, 10) AS UNSIGNED)) AS max_claim
          FROM gd_publish_step p
         WHERE p.tenant_id = '128671' AND p.is_deleted = 0 AND p.step_name LIKE 'W0_CLAIM_%'
           AND p.job_id IN ('2113832045670174722', '2113831088173486082', '2113831074160316417', '2113834080440291330')
         GROUP BY p.job_id) c ON c.job_id = CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci
   SET j.row_version = GREATEST(j.row_version, c.max_claim) + 1, j.attempt_count = 0, j.lease_owner = NULL,
       j.lease_expires_at = NULL, j.next_attempt_at = NULL, j.error_code = NULL, j.error_message = NULL, j.error_details = NULL
 WHERE j.tenant_id = '128671' AND j.is_deleted = 0 AND j.command = 'COMPLETE_GD' AND j.job_status = 'COMMITTING_GD'
   AND j.id IN (2113832045670174722, 2113831088173486082, 2113831074160316417, 2113834080440291330);

COMMIT;

-- 3. check: preview 0 returns nothing. Refresh the GD list once (it nudges the worker): within a minute the 4 jobs are COMPLETED and
--    GD-2610-1069 / 1138 / 1165 / 1088 Completed. A job that ends FAILED put its GD back to Created (nothing written): complete it again.
