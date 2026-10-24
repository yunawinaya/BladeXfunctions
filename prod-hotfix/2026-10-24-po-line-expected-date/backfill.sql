-- Prod backfill 2026-10-24 (LSH-OPS-09): PO lines saved with a blank arrival date keep NULL po_expected_date.
-- Why: PO_SAVE v45 (live since 2026-10-19 11:03:58) took the PO header's date only when a line's date was MISSING; the PO
-- form sends an EMPTY one (''), so the line was written without a date. PO_SAVE.json in this folder (dev v46, 12:35) treats
-- '' as missing too. This copies each affected line's header date, which is what the fixed save writes.
-- Scope: live lines without a date, whose PO header has one, created since v45 went live. Checked 12:40 MYT:
--   128671 (LSH) 46 POs / 90 lines (10-23 09:19 to 10-24 12:19); 237197 2 POs / 2 lines; 528521 1 PO / 1 line.
-- Run AFTER pasting PO_SAVE.json, so no new line lands in between. A second run changes only lines still without a date.
-- Both date columns are TIMESTAMP, so the copy keeps the value exactly (no time-zone maths).

-- 0. preview per tenant (expect the counts above; LSH may be higher if more POs were saved before the paste)
SELECT h.tenant_id, COUNT(DISTINCT h.id) AS pos, COUNT(*) AS line_count, MIN(l.create_time) AS first_line, MAX(l.create_time) AS last_line
  FROM purchase_order_2ukyuanr_sub l
  JOIN purchase_order h ON h.id = l.purchase_order_id
 WHERE l.is_deleted = 0 AND h.is_deleted = 0
   AND l.po_expected_date IS NULL AND h.po_expected_date IS NOT NULL
   AND l.create_time >= '2026-10-19 11:03:58'
 GROUP BY h.tenant_id;

-- 1. preview the LSH lines: each gets its PO's header date
SELECT h.purchase_order_no, h.po_status, l.line_index, l.line_status, h.po_expected_date AS new_line_date, l.create_time
  FROM purchase_order_2ukyuanr_sub l
  JOIN purchase_order h ON h.id = l.purchase_order_id
 WHERE l.tenant_id = '128671' AND h.tenant_id = '128671'
   AND l.is_deleted = 0 AND h.is_deleted = 0
   AND l.po_expected_date IS NULL AND h.po_expected_date IS NOT NULL
   AND l.create_time >= '2026-10-19 11:03:58'
 ORDER BY h.purchase_order_no, l.line_index;

-- 2. LSH (expect 90 rows, or the step-0 count)
START TRANSACTION;
UPDATE purchase_order_2ukyuanr_sub l
  JOIN purchase_order h ON h.id = l.purchase_order_id
   SET l.po_expected_date = h.po_expected_date,
       l.update_time = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR)
 WHERE l.tenant_id = '128671' AND h.tenant_id = '128671'
   AND l.is_deleted = 0 AND h.is_deleted = 0
   AND l.po_expected_date IS NULL AND h.po_expected_date IS NOT NULL
   AND l.create_time >= '2026-10-19 11:03:58';
COMMIT;

-- 3. OPTIONAL, your call: the same bug at the two other tenants (expect 3 rows: 237197 x2, 528521 x1)
START TRANSACTION;
UPDATE purchase_order_2ukyuanr_sub l
  JOIN purchase_order h ON h.id = l.purchase_order_id
   SET l.po_expected_date = h.po_expected_date,
       l.update_time = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR)
 WHERE l.tenant_id IN ('237197', '528521') AND h.tenant_id = l.tenant_id
   AND l.is_deleted = 0 AND h.is_deleted = 0
   AND l.po_expected_date IS NULL AND h.po_expected_date IS NOT NULL
   AND l.create_time >= '2026-10-19 11:03:58';
COMMIT;

-- 4. check: step 0 again returns no LSH row (and none for 237197 / 528521 if step 3 ran)
