-- Prod repair 2026-10-24, tenant 128671 (LSH): put back gd_publish_step.step_status / error_code that PACKING_SAVE v31's guard
-- overwrote on every row of the tenant, over and over: update_node_PGabortDone (PACKING_DONE / ABORTED_BEFORE_BUSINESS),
-- update_node_PGstarted (PACKING_REVIEW / BUSINESS_STARTED) and update_node_PGabortReview (PACKING_REVIEW /
-- CLEANUP_REQUIRES_REVIEW). Source: gd_publish_step_pitr_1105, the DBA's point-in-time copy as of
-- 2026-10-24 03:05:59 UTC (11:05:59 MYT, before the guard existed). Run only after PACKING_SAVE is back on v58.
-- Only rows that still carry the overwrite are changed; a row a job has written since is left as it is. A second run changes
-- nothing. Rows created after 11:05:59 are not in the copy and are handled separately.

-- 0. preview: what each overwritten row goes back to
SELECT b.step_status AS restore_to, IFNULL(b.error_code, '') AS error_code_back, COUNT(*) AS step_rows
  FROM gd_publish_step p
  JOIN gd_publish_step_pitr_1105 b ON b.id = p.id AND b.tenant_id = p.tenant_id
 WHERE p.tenant_id = '128671' AND p.is_deleted = 0
   AND (p.step_status, p.error_code) IN (('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'),
                                         ('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'))
 GROUP BY b.step_status, b.error_code
 ORDER BY step_rows DESC;

-- 0b. overwritten rows the copy cannot restore (created after 11:05:59): handled separately
SELECT COUNT(*) AS not_in_copy
  FROM gd_publish_step p
  LEFT JOIN gd_publish_step_pitr_1105 b ON b.id = p.id AND b.tenant_id = p.tenant_id
 WHERE p.tenant_id = '128671' AND p.is_deleted = 0
   AND (p.step_status, p.error_code) IN (('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'),
                                         ('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'))
   AND b.id IS NULL;

START TRANSACTION;

UPDATE gd_publish_step p
  JOIN gd_publish_step_pitr_1105 b ON b.id = p.id AND b.tenant_id = p.tenant_id
   SET p.step_status = b.step_status, p.error_code = b.error_code
 WHERE p.tenant_id = '128671' AND p.is_deleted = 0
   AND (p.step_status, p.error_code) IN (('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'),
                                         ('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'));

COMMIT;

-- 1. check: preview 0 now returns nothing; 0b still shows only the rows created after 11:05:59.
