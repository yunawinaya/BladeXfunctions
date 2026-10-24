-- Prod repair 2026-10-24, tenant 128671 (LSH): finish the GD Created V2 jobs of 5 deliveries that the warehouse picked and packed
-- by hand while their jobs were stuck: GD-2610-1212, 1221, 1258, 1270, 1279. resume_19_created.sql resumed the other 14 (all
-- finish normally); these 5 went back to REQUIRES_REVIEW because the Packing re-save (classic, 10:56-11:2x) cancelled the
-- reservations their create job had made and made new ones on the box, and the job refuses to finish over reservations it does
-- not recognise. The deliveries themselves are consistent (checked 12:0x: every allocation has its open reservation, picking and
-- packing Completed). What the job had left to do, done here the way the resumed jobs did it:
--   1. P7B_SO_PROJECTION: each SO line's planned_qty + this delivery's quantity (23 lines; all planned 0, no other open delivery on
--      them, same unit as the GD line; the SO headers already read gd_status Created).
--   2. P7D_JOB_COMMITTED: the job GD_COMMITTED. The Picking consumer then closes it the usual LSH way (no automatic Picking at LSH:
--      route NO_PICK, job COMPLETED, event DONE), after which the deliveries can be completed.
-- Not replayed: P7E_REORDER (the reorder tracking in Redis, not reachable from SQL) for these 5 deliveries.
-- Re-checked when it runs; a second run changes nothing.

-- 0. preview: the SO lines (expect 23 rows, planned_now 0, open_other 0)
SELECT g.delivery_no, CAST(sl.id AS CHAR) AS so_line, IFNULL(sl.planned_qty, 0) AS planned_now, l.gd_qty AS adds,
       (SELECT IFNULL(SUM(l2.gd_qty), 0) FROM goods_delivery_fwii8mvb_sub l2
          JOIN goods_delivery g2 ON g2.id = l2.goods_delivery_id AND g2.tenant_id = '128671' AND g2.is_deleted = 0
         WHERE l2.is_deleted = 0 AND l2.so_line_item_id = CAST(sl.id AS CHAR) COLLATE utf8mb4_general_ci AND g2.gd_status IN ('Created', 'Processing')
           AND g2.id <> g.id) AS open_other
  FROM goods_delivery g
  JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0
  JOIN sales_order_axszx8cj_sub sl ON sl.id = CAST(l.so_line_item_id AS UNSIGNED) AND sl.is_deleted = 0
 WHERE g.tenant_id = '128671' AND g.is_deleted = 0 AND g.gd_status = 'Created'
   AND g.id IN (2113770932081397761, 2113776377957322754, 2113805520975564801, 2113810245947101186, 2113814739351113730)
 ORDER BY g.delivery_no, sl.id;

-- 0b. preview: the jobs (expect 5 rows, REQUIRES_REVIEW / GD_PUBLISH_AFTER_INVENTORY_FAILED, event READY)
SELECT j.gd_no, j.job_status, j.error_code, o.dispatch_status
  FROM gd_async_job j
  LEFT JOIN gd_outbox o ON o.tenant_id = j.tenant_id AND o.job_id = CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci AND o.is_deleted = 0
 WHERE j.tenant_id = '128671'
   AND j.id IN (2113770906181570561, 2113776365168889858, 2113805489241460738, 2113810234467291137, 2113814726516543489);

START TRANSACTION;

-- 1. the SO lines' planned quantity (expect 23)
UPDATE sales_order_axszx8cj_sub sl
  JOIN (SELECT CAST(l.so_line_item_id AS UNSIGNED) AS so_line_id, SUM(l.gd_qty) AS add_qty
          FROM goods_delivery_fwii8mvb_sub l
          JOIN goods_delivery g ON g.id = l.goods_delivery_id AND g.tenant_id = '128671' AND g.is_deleted = 0 AND g.gd_status = 'Created'
         WHERE l.is_deleted = 0
           AND g.id IN (2113770932081397761, 2113776377957322754, 2113805520975564801, 2113810245947101186, 2113814739351113730)
         GROUP BY CAST(l.so_line_item_id AS UNSIGNED)) x ON sl.id = x.so_line_id
   SET sl.planned_qty = IFNULL(sl.planned_qty, 0) + x.add_qty
 WHERE sl.is_deleted = 0 AND IFNULL(sl.planned_qty, 0) = 0 AND IFNULL(sl.delivered_qty, 0) = 0;

-- 2. the jobs GD_COMMITTED (expect 5)
UPDATE gd_async_job j
   SET j.job_status = 'GD_COMMITTED', j.progress_percent = 85, j.progress_message = CONCAT('GD ', j.gd_no, ' created'),
       j.gd_committed_at = UTC_TIMESTAMP(), j.finished_at = NULL, j.error_code = NULL, j.error_message = NULL, j.error_details = NULL,
       j.lease_owner = NULL, j.lease_expires_at = NULL, j.next_attempt_at = NULL, j.row_version = j.row_version + 1
 WHERE j.tenant_id = '128671' AND j.is_deleted = 0 AND j.command = 'CREATE_GD_FROM_FORM'
   AND j.id IN (2113770906181570561, 2113776365168889858, 2113805489241460738, 2113810234467291137, 2113814726516543489)
   AND j.job_status = 'REQUIRES_REVIEW' AND j.error_code = 'GD_PUBLISH_AFTER_INVENTORY_FAILED';

COMMIT;

-- 3. check: refresh the GD list once (it kicks the consumer). Within a minute the 5 jobs read COMPLETED and their events DONE;
--    then the 5 deliveries can be completed as usual.
