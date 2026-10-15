-- BUG-20261015-020 follow-up / TAF (tenant 681409) / Picking records left unstamped.
-- GD_UNUSED_FN_NEW stamped Picking records only under each GD line's line_to_id (fixed: prod v50, dev v55).
-- These 8 records were delivered by Completed GDs but still show that qty as available for a new
-- GD-from-PP. This sets each record's delivered_qty to what Completed GDs actually delivered from it,
-- and marks the 7 Picking headers whose records are now fully delivered.
--   PK-00849 0->0.4, PK-01425 0->10, PK-01790 0->6, PK-02651 0->5, PK-03257 0->5, PK-03266 0->14,
--   PK-03501 3.6->13.6 (4.4 genuinely still picked), PK-03767 25->55 (TA188799 30 + TA189054 25; picked 30).
-- PK-03767 stays at 55 even if TA189054 is reverted later: the revert subtracts its own 25 (-> 30).
-- Touches ONLY transfer_order_vrqs3cmr_sub.delivered_qty/delivery_status/update_time and
-- transfer_order.delivery_status/update_time. No inventory, GD, SO or reservation rows change.
--
-- Select the production bladex_boot database in Bytebase and enable Bytebase's built-in backup
-- option before executing. Prepared only: NOT executed against production.
-- Expected: records_ready = 8 and headers_ready = 7. If not, STOP; do not loosen the guards.
-- Expected: first ROW_COUNT = 8, second ROW_COUNT = 7. A rerun is a no-op (0 and 0).

SET SESSION MAX_EXECUTION_TIME = 25000;

SELECT COUNT(*) AS records_ready
FROM transfer_order_vrqs3cmr_sub AS r
WHERE r.tenant_id = '681409'
  AND r.is_deleted = 0
  AND COALESCE(r.reserved_qty, 0) = 0
  AND (r.id, r.transfer_order_id, r.store_out_qty, r.delivered_qty, r.update_time) IN (
    (2042773830808248321, 2042773820729335809, 0.4, 0, '2026-04-11 09:16:48.820'),
    (2055134817602711554, 2055134816503803906, 10, 0, '2026-05-15 11:54:57.731'),
    (2064203103293001729, 2064203100768030721, 6, 0, '2026-06-09 12:29:05.516'),
    (2082999550531997698, 2082999546455134210, 5, 0, '2026-07-31 09:19:27.764'),
    (2095395118042451969, 2095395113768456193, 5, 0, '2026-09-03 14:15:01.357'),
    (2095784779332063234, 2095726210796621826, 14, 0, '2026-09-04 16:03:23.847'),
    (2101126997680984066, 2101126991452442625, 18, 3.6, '2026-09-19 17:23:57.112'),
    (2105515679116562433, 2105515672686694402, 30, 25, '2026-10-15 12:01:31.996'))
  AND CASE r.id
      WHEN 2042773830808248321 THEN 0.4
      WHEN 2055134817602711554 THEN 10
      WHEN 2064203103293001729 THEN 6
      WHEN 2082999550531997698 THEN 5
      WHEN 2095395118042451969 THEN 5
      WHEN 2095784779332063234 THEN 14
      WHEN 2101126997680984066 THEN 13.6
      WHEN 2105515679116562433 THEN 55
    END = (SELECT COALESCE(SUM(t.q), 0)
       FROM goods_delivery_fwii8mvb_sub AS gl
       JOIN goods_delivery AS gd
         ON gd.id = gl.goods_delivery_id AND gd.tenant_id = gl.tenant_id
       CROSS JOIN JSON_TABLE(gl.temp_qty_data, '$[*]' COLUMNS (
           rid VARCHAR(32) PATH '$.picking_record_id',
           q DECIMAL(20,8) PATH '$.gd_quantity')) AS t
       WHERE gl.tenant_id = '681409' AND gl.is_deleted = 0 AND gd.is_deleted = 0
         AND gd.gd_status = 'Completed'
         AND gl.id IN (2042817633835089922, 2055135942640873473, 2066726192367869954, 2083018236441530369, 2095396803154415619, 2095788534882504706, 2101179355987316742, 2105546232960258055, 2107708970817949701, 2109812482347503620)
         AND CAST(t.rid AS UNSIGNED) = r.id);

SELECT COUNT(*) AS headers_ready
FROM transfer_order AS p
WHERE p.tenant_id = '681409'
  AND p.is_deleted = 0
  AND p.to_status = 'Completed'
  AND COALESCE(p.delivery_status, '') IN ('', 'Partially Delivered')
  AND (p.id, p.to_id, p.update_time) IN (
    (2042773820729335809, 'PK-00849', '2026-04-11 09:16:48.764'),
    (2055134816503803906, 'PK-01425', '2026-05-15 11:54:57.674'),
    (2064203100768030721, 'PK-01790', '2026-06-09 12:29:05.395'),
    (2082999546455134210, 'PK-02651', '2026-07-31 09:19:27.613'),
    (2095395113768456193, 'PK-03257', '2026-09-03 14:15:01.168'),
    (2095726210796621826, 'PK-03266', '2026-09-04 16:03:26.940'),
    (2105515672686694402, 'PK-03767', '2026-10-15 12:01:32.048'));

UPDATE transfer_order_vrqs3cmr_sub AS r
SET r.delivered_qty = CASE r.id
      WHEN 2042773830808248321 THEN 0.4
      WHEN 2055134817602711554 THEN 10
      WHEN 2064203103293001729 THEN 6
      WHEN 2082999550531997698 THEN 5
      WHEN 2095395118042451969 THEN 5
      WHEN 2095784779332063234 THEN 14
      WHEN 2101126997680984066 THEN 13.6
      WHEN 2105515679116562433 THEN 55
    END,
    r.delivery_status = CASE r.id
      WHEN 2042773830808248321 THEN 'Fully Delivered'
      WHEN 2055134817602711554 THEN 'Fully Delivered'
      WHEN 2064203103293001729 THEN 'Fully Delivered'
      WHEN 2082999550531997698 THEN 'Fully Delivered'
      WHEN 2095395118042451969 THEN 'Fully Delivered'
      WHEN 2095784779332063234 THEN 'Fully Delivered'
      WHEN 2101126997680984066 THEN 'Partially Delivered'
      WHEN 2105515679116562433 THEN 'Fully Delivered'
    END,
    r.update_time = CURRENT_TIMESTAMP(3)
WHERE r.tenant_id = '681409'
  AND r.is_deleted = 0
  AND COALESCE(r.reserved_qty, 0) = 0
  AND (r.id, r.transfer_order_id, r.store_out_qty, r.delivered_qty, r.update_time) IN (
    (2042773830808248321, 2042773820729335809, 0.4, 0, '2026-04-11 09:16:48.820'),
    (2055134817602711554, 2055134816503803906, 10, 0, '2026-05-15 11:54:57.731'),
    (2064203103293001729, 2064203100768030721, 6, 0, '2026-06-09 12:29:05.516'),
    (2082999550531997698, 2082999546455134210, 5, 0, '2026-07-31 09:19:27.764'),
    (2095395118042451969, 2095395113768456193, 5, 0, '2026-09-03 14:15:01.357'),
    (2095784779332063234, 2095726210796621826, 14, 0, '2026-09-04 16:03:23.847'),
    (2101126997680984066, 2101126991452442625, 18, 3.6, '2026-09-19 17:23:57.112'),
    (2105515679116562433, 2105515672686694402, 30, 25, '2026-10-15 12:01:31.996'))
  AND CASE r.id
      WHEN 2042773830808248321 THEN 0.4
      WHEN 2055134817602711554 THEN 10
      WHEN 2064203103293001729 THEN 6
      WHEN 2082999550531997698 THEN 5
      WHEN 2095395118042451969 THEN 5
      WHEN 2095784779332063234 THEN 14
      WHEN 2101126997680984066 THEN 13.6
      WHEN 2105515679116562433 THEN 55
    END = (SELECT COALESCE(SUM(t.q), 0)
       FROM goods_delivery_fwii8mvb_sub AS gl
       JOIN goods_delivery AS gd
         ON gd.id = gl.goods_delivery_id AND gd.tenant_id = gl.tenant_id
       CROSS JOIN JSON_TABLE(gl.temp_qty_data, '$[*]' COLUMNS (
           rid VARCHAR(32) PATH '$.picking_record_id',
           q DECIMAL(20,8) PATH '$.gd_quantity')) AS t
       WHERE gl.tenant_id = '681409' AND gl.is_deleted = 0 AND gd.is_deleted = 0
         AND gd.gd_status = 'Completed'
         AND gl.id IN (2042817633835089922, 2055135942640873473, 2066726192367869954, 2083018236441530369, 2095396803154415619, 2095788534882504706, 2101179355987316742, 2105546232960258055, 2107708970817949701, 2109812482347503620)
         AND CAST(t.rid AS UNSIGNED) = r.id);

SELECT ROW_COUNT() AS changed_records; -- Expected 8.

UPDATE transfer_order AS p
SET p.delivery_status = 'Fully Delivered', p.update_time = CURRENT_TIMESTAMP(3)
WHERE p.tenant_id = '681409'
  AND p.is_deleted = 0
  AND p.to_status = 'Completed'
  AND COALESCE(p.delivery_status, '') IN ('', 'Partially Delivered')
  AND (p.id, p.to_id, p.update_time) IN (
    (2042773820729335809, 'PK-00849', '2026-04-11 09:16:48.764'),
    (2055134816503803906, 'PK-01425', '2026-05-15 11:54:57.674'),
    (2064203100768030721, 'PK-01790', '2026-06-09 12:29:05.395'),
    (2082999546455134210, 'PK-02651', '2026-07-31 09:19:27.613'),
    (2095395113768456193, 'PK-03257', '2026-09-03 14:15:01.168'),
    (2095726210796621826, 'PK-03266', '2026-09-04 16:03:26.940'),
    (2105515672686694402, 'PK-03767', '2026-10-15 12:01:32.048'))
  AND NOT EXISTS (
    SELECT 1 FROM transfer_order_vrqs3cmr_sub AS r
    WHERE r.tenant_id = p.tenant_id AND r.transfer_order_id = p.id AND r.is_deleted = 0
      AND NOT (r.delivered_qty >= r.store_out_qty));

SELECT ROW_COUNT() AS changed_headers; -- Expected 7.

SELECT p.to_id, r.id, r.store_out_qty, r.delivered_qty, r.reserved_qty,
       r.store_out_qty - r.delivered_qty - COALESCE(r.reserved_qty, 0) AS still_available,
       r.delivery_status, p.delivery_status AS header_status
FROM transfer_order_vrqs3cmr_sub AS r
JOIN transfer_order AS p ON p.id = r.transfer_order_id AND p.tenant_id = r.tenant_id
WHERE r.tenant_id = '681409' AND r.id IN (2042773830808248321, 2055134817602711554, 2064203103293001729, 2082999550531997698, 2095395118042451969, 2095784779332063234, 2101126997680984066, 2105515679116562433)
ORDER BY p.to_id;
-- Expected: still_available <= 0 on every row except PK-03501 (4.4, genuinely picked and undelivered).
-- Header status Fully Delivered on all except PK-03501 (Partially Delivered, unchanged).
