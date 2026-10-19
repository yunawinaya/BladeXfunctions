-- PROD, optional. 7 SO lines that GD Revert Completed left with a blank line_status (it wrote "" for an
-- undelivered line; GD_REVERT_COMPLETED v16 writes "Issued", the status SO save gives an issued line).
-- 528521 SO-0626-003 x4 (GD/20260609/010), 836238 SO-01125 (JO-01058), 954052 SO-2610/003 x2 (DO-2610/003).

-- 1. Pre-check: expect exactly 7 rows, all line_status '' and delivered_qty 0.
SELECT id, tenant_id, line_status, delivered_qty, planned_qty
FROM sales_order_axszx8cj_sub
WHERE id IN (2064279173417521154, 2064279173417521155, 2064279173417521156, 2064279173417521157,
             2110539560386695171, 2107738110560440322, 2107738110564634625)
  AND is_deleted = 0 AND line_status = '' AND IFNULL(delivered_qty, 0) = 0;

-- 2. Repair: expect 7 rows affected.
UPDATE sales_order_axszx8cj_sub
SET line_status = 'Issued'
WHERE id IN (2064279173417521154, 2064279173417521155, 2064279173417521156, 2064279173417521157,
             2110539560386695171, 2107738110560440322, 2107738110564634625)
  AND is_deleted = 0 AND line_status = '' AND IFNULL(delivered_qty, 0) = 0;
