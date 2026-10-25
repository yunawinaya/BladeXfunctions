-- LSH (tenant 128671): GD-2610-1245 cannot complete (GDC_INVENTORY_INSUFFICIENT, movement M1). Bin 2108721631730995201 lost
-- 5 Reserved of material 2113380262850207757 batch 2113417627945799681 on 2026-10-24: GD-2610-1245's classic Packing save
-- (ADD_INVENTORY_NEW, +5 at 13:38:09.5) was overwritten by GD-2610-1180's V2 completion (INVENTORY_BULK_APPLY, -20, read before
-- the +5 landed). The movement ledger nets +5 Reserved at that bin; both balance rows read 0. The only Reserved mismatch in LSH.
-- Each statement is guarded by the current values: run once, expect 1 row each. A 0 means something changed; stop and check.

UPDATE item_batch_balance
   SET reserved_qty = reserved_qty + 5, balance_quantity = balance_quantity + 5,
       update_time = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)
 WHERE tenant_id = '128671' AND id = 2113441470903095298
   AND material_id = '2113380262850207757' AND batch_id = '2113417627945799681' AND location_id = '2108721631730995201'
   AND reserved_qty = 0 AND balance_quantity = 0;  -- expect 1

UPDATE item_balance
   SET reserved_qty = reserved_qty + 5, balance_quantity = balance_quantity + 5,
       update_time = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)
 WHERE tenant_id = '128671' AND id = 2113441470873735170
   AND material_id = '2113380262850207757' AND location_id = '2108721631730995201'
   AND reserved_qty = 0 AND balance_quantity = 0;  -- expect 1
