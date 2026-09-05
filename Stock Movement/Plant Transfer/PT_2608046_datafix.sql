-- ============================================================================
-- Data repair: PT/2608046 (receiving) -- stranded 100 In Transit at bin A1
--   tenant 035843, org 1993950065513086977
--   parent  PT/2608045  id 2090364021868990466  (issuing, KA2 40 + KA4 140)
--   child   PT/2608046  id 2090364133135486977  (receiving, A8 40 + 140)
--   item    2036390030890066007  235/40R18 SUREGRIP PRO SPORT 95Y XL
--   batch   2089209422080512002  (2603-2088)
--
-- Cause: SM_PLANT_TRANSFER / code_node_9E4f9nuV re-resolved the balance entry by
-- batch_id alone. The source line drew the SAME batch from TWO bins, so both
-- receiving lines were stamped with the FIRST entry's temp_qty_data (KA2, 40).
-- Line qty stayed right (40 / 140) so A8 received 180, but the In Transit OUT
-- was computed from temp_qty_data and deducted 40 + 40 = 80. 100 stranded.
-- Code fix: PTsaveWorkflowChangeFlow.json, node code_node_9E4f9nuV.
--
-- RUN AS ONE TRANSACTION. Every UPDATE is guarded on the current wrong value,
-- so re-running after a successful repair changes 0 rows.
-- Expected affected rows: 1 per statement (6 total).
-- ============================================================================

-- ---------------------------------------------------------------- pre-check --
SELECT 'movement (2nd In Transit OUT, expect 40)' AS chk, id, quantity, base_qty, actual_qty
  FROM inventory_movement WHERE id = 2090659245908430849;
SELECT 'ledger row (expect open 100)' AS chk, id, transit_qty, received_qty, open_qty, status
  FROM in_transit_detail WHERE id = 2090364086796816396;
SELECT 'batch balance A1 (expect intransit 100)' AS chk, id, intransit_qty, balance_quantity
  FROM item_batch_balance WHERE id = 2090364051241701377;
SELECT 'item balance A1 (expect intransit 100)' AS chk, id, intransit_qty, balance_quantity
  FROM item_balance WHERE id = 2090364051350753282;

START TRANSACTION;

-- 1. The under-stated In Transit OUT movement: 40 -> 140 -------------------- --
UPDATE inventory_movement
   SET quantity        = 140.000,
       base_qty        = 140.000,
       actual_qty      = -140.000,
       actual_base_qty = -140.000
 WHERE id = 2090659245908430849
   AND trx_no = 'PT/2608046'
   AND movement = 'OUT'
   AND inventory_category = 'In Transit'
   AND quantity = 40.000
   AND is_deleted = 0;

-- 2. In Transit ledger row for the KA4 leg: close it ------------------------ --
UPDATE in_transit_detail
   SET received_qty  = 140.000,
       open_qty      = 0.000,
       status        = 'Received',
       received_date = '2026-08-20 00:00:00'
 WHERE id = 2090364086796816396
   AND transit_qty = 140.000
   AND received_qty = 40.000
   AND open_qty = 100.000
   AND status = 'In Transit'
   AND is_deleted = 0;

-- 3. Batch balance at the transit bin A1 (2016763053829332993) -------------- --
UPDATE item_batch_balance
   SET intransit_qty    = 0.000,
       balance_quantity = 0.000
 WHERE id = 2090364051241701377
   AND material_id = '2036390030890066007'
   AND batch_id = 2089209422080512002
   AND location_id = 2016763053829332993
   AND intransit_qty = 100.000
   AND balance_quantity = 100.000
   AND is_deleted = 0;

-- 4. Item-level balance at the same bin (only this batch contributes) ------- --
UPDATE item_balance
   SET intransit_qty    = 0.000,
       balance_quantity = 0.000
 WHERE id = 2090364051350753282
   AND material_id = '2036390030890066007'
   AND location_id = 2016763053829332993
   AND intransit_qty = 100.000
   AND balance_quantity = 100.000
   AND is_deleted = 0;

-- 5. Receiving line 11: restore the KA4 balance entry it should have carried  --
--    (leaving the KA2 copy here makes a later cancel reverse only 40 again)   --
UPDATE plant_transfer_d2c7o1jd_sub
   SET temp_qty_data = '[{"location_id":"2046431349702303745","organization_id":"1993950065513086977","remark":null,"block_qty":0,"intransit_qty":0,"remark3":null,"remark2":null,"tenant_id":"035843","reserved_qty":0,"expired_date":null,"update_user":"2077235340023087105","plant_id":"1993950927744548865","update_time":"2026-08-18 15:23:47.624","material_uom":"2036386568462753794","create_user":"2077235340023087105","batch_id":"2089209422080512002","unrestricted_qty":140,"create_time":"2026-08-18 15:23:47.624","sub_tenant_id":"1993950065513086977","manufacturing_date":"2026-07-20 00:00:00.000","material_id":"2036390030890066007","is_deleted":0,"doc_date":"2026-08-18 00:00:00.000","balance_quantity":140,"qualityinsp_qty":0,"create_dept":"1993950927744548865","category":"Unrestricted","fm_key":"vzl2wuo7","sm_quantity":140}]'
 WHERE id = 2090364133928210444
   AND plant_transfer_id = 2090364133135486977
   AND item_selection = '2036390030890066007'
   AND total_quantity = 140.000
   AND temp_qty_data LIKE '%2046427227963957249%'
   AND is_deleted = 0;

-- 6. Header Item Balance subform row 10: same copied-entry corruption -------- --
UPDATE plant_transfer_371v7gdf_sub
   SET location_id      = 2046431349702303745,
       sm_quantity      = 140.000,
       unrestricted_qty = 140.000,
       balance_quantity = 140.000
 WHERE id = 2090659228384628747
   AND plant_transfer_id = 2090364133135486977
   AND material_id = '2036390030890066007'
   AND batch_id = 2089209422080512002
   AND row_index = '10'
   AND location_id = 2046427227963957249
   AND sm_quantity = 40.000
   AND is_deleted = 0;

-- Inspect the 6 row counts above, then:
COMMIT;
-- ROLLBACK;

-- --------------------------------------------------------------- post-check --
-- Every row below must come back empty.
SELECT 'still stranded' AS chk, id, open_qty, status
  FROM in_transit_detail
 WHERE doc_id = '2090364021868990466' AND is_deleted = 0
   AND (open_qty <> 0 OR status <> 'Received');

SELECT 'balance not zeroed' AS chk, id, intransit_qty, balance_quantity
  FROM item_batch_balance
 WHERE id = 2090364051241701377 AND (intransit_qty <> 0 OR balance_quantity <> 0);

-- Movement ledger must now net to zero at the transit bin for this batch.
SELECT 'transit ledger net (must be 0)' AS chk,
       SUM(CASE WHEN movement = 'IN' THEN quantity ELSE -quantity END) AS net
  FROM inventory_movement
 WHERE item_id = 2036390030890066007
   AND batch_number_id = 2089209422080512002
   AND bin_location_id = 2016763053829332993
   AND inventory_category = 'In Transit'
   AND is_deleted = 0;
