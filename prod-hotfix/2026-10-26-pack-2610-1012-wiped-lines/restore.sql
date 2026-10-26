-- PACK-2610-1012 (LSH 128671, GD-2610-1175): undelete the 2 item lines the Picking added at 10:57:49 and a stale mobile
-- Created save (PACKING_SAVE run 2114552363296624642, carmen, 10:59:04, sent table_item_source: []) soft-deleted at 10:59:05.
-- Run ONLY after carmen has left the Packing (closed it without saving), or her next save wipes them again.
-- picked_qty / remaining_qty / line_status are a projection the client recomputes from the boxes on open, so they stay as they are.

-- 1. preview: must show 2 rows, is_deleted = 1
SELECT CAST(id AS CHAR) id, item_code, total_quantity, is_deleted, update_time
  FROM packing_jz8m9w3h_sub
 WHERE packing_id = 2113542408112312322 AND id IN (2114552050015670273, 2114552050015670274) AND tenant_id = '128671';

-- 2. restore (expect 2 rows affected)
UPDATE packing_jz8m9w3h_sub
   SET is_deleted = 0, update_time = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR)
 WHERE packing_id = 2113542408112312322 AND id IN (2114552050015670273, 2114552050015670274)
   AND tenant_id = '128671' AND is_deleted = 1;
