-- Prod 2026-10-26, Kenhin (tenant 528521, Auto Complete GD on): unlock 3 Completed Pickings left locked by a failed classic
-- confirm. Classic PICKING writes the Picking Completed, then completes its GDs one by one. A GD whose item has no Weighted
-- Average costing record at plant 2006975338995011586 fails, the run dies, and the Picking keeps is_processing = 1.
--   PI-20261023-0307  10-23 14:14  item 2058889519077183527  (its GDs were completed by hand on 10-23)
--   PI-20261023-0310  10-23 16:01  item 2058889534810017794  (its GDs were completed by hand on 10-23)
--   PI-20261026-0315  10-26 13:12  item 2102212734669168645 V131  (7 GDs still Created: complete them from the GD form)
-- The costing records for all three items exist now. A second run changes nothing.

-- 0. preview (expect 3 rows: Completed, is_processing 1)
SELECT to_id, to_status, is_processing, update_time
  FROM transfer_order
 WHERE tenant_id = '528521' AND is_deleted = 0
   AND to_id IN ('PI-20261023-0307', 'PI-20261023-0310', 'PI-20261026-0315');

-- 1. unlock (expect 3 rows)
UPDATE transfer_order
   SET is_processing = 0
 WHERE tenant_id = '528521' AND is_deleted = 0
   AND to_id IN ('PI-20261023-0307', 'PI-20261023-0310', 'PI-20261026-0315')
   AND to_status = 'Completed' AND is_processing = 1;

-- 2. check: preview 0 shows is_processing 0 on all three
