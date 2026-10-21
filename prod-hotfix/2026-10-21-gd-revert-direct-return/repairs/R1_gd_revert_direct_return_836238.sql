-- R1: stock the classic GD revert never put back, tenant 836238: JO-01054, JO-01069 (7 keys, 8 units).
-- Classic GD_PROCESS_REVERT <= v13 returned only reserved stock; what a completion took straight from Unrestricted stayed out
-- (fixed in v14). Per key this writes what v14 would have written through ADD_INVENTORY_NEW: a GDL-R IN Unrestricted movement
-- at the cost it left at (doc_date = the revert's day; user = who reverted), the batch balance and the item balance + qty, and
-- a FIFO layer (its batch's next sequence, initial = available = qty). Generated 2026-10-21 16:04 MYT by build_repair_sql.py; see ../README.md.
-- Each key's statements are guarded by its repair movement id: a second run changes nothing.

-- ========== BEFORE (read-only) -- each must return what its comment says ==========

-- B1: 1 row: 0 | 0 (the repair has not run; its ids are free)
SELECT (SELECT COUNT(*) FROM inventory_movement WHERE id IN (2112817362120904704, 2112817362120904706, 2112817362120904708, 2112817362120904710, 2112817362120904712, 2112817362120904714, 2112817362120904716)) AS movements,
       (SELECT COUNT(*) FROM fifo_costing_history WHERE id IN (2112817362120904705, 2112817362120904707, 2112817362120904709, 2112817362120904711, 2112817362120904713, 2112817362120904715, 2112817362120904717)) AS layers;

-- B2: 6 rows; fifo_available = balance_quantity on every row. Note unrestricted_qty and balance_quantity (A2 compares).
SELECT CAST(b.material_id AS CHAR) AS item, CAST(b.batch_id AS CHAR) AS batch, b.unrestricted_qty, b.balance_quantity,
       (SELECT SUM(f.fifo_available_quantity) FROM fifo_costing_history f WHERE f.tenant_id = b.tenant_id AND f.material_id = b.material_id
          AND f.batch_id = b.batch_id AND f.plant_id = b.plant_id AND f.is_deleted = 0) AS fifo_available
  FROM item_batch_balance b WHERE b.tenant_id = '836238' AND b.id IN (2064201900651827201, 2064201911150170114, 2064201919098376193, 2064203418062934017, 2064203427424620546, 2064203461826301954) ORDER BY b.material_id, b.batch_id;

-- B3: 6 rows; unrestricted_qty = batches_unrestricted and balance_quantity = batches_balance on every row. Note them (A3).
SELECT CAST(i.material_id AS CHAR) AS item, i.unrestricted_qty, i.balance_quantity,
       (SELECT SUM(b.unrestricted_qty) FROM item_batch_balance b WHERE b.tenant_id = i.tenant_id AND b.material_id = i.material_id
          AND b.location_id = i.location_id AND b.plant_id = i.plant_id AND b.is_deleted = 0) AS batches_unrestricted,
       (SELECT SUM(b.balance_quantity) FROM item_batch_balance b WHERE b.tenant_id = i.tenant_id AND b.material_id = i.material_id
          AND b.location_id = i.location_id AND b.plant_id = i.plant_id AND b.is_deleted = 0) AS batches_balance
  FROM item_balance i WHERE i.tenant_id = '836238' AND i.id IN (2064201900802822145, 2064201911322136577, 2064201919249371138, 2064203418230706177, 2064203427575615489, 2064203461989879810) ORDER BY i.material_id;

-- ========== REPAIR (one transaction) ==========

START TRANSACTION;

-- JO-01054: item 2037082991951757314 batch 2064203427168768001 bin 2031936537033715714: +1 Unrestricted at 0
UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064203427424620546 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904704);
UPDATE item_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064203427575615489 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904704);
INSERT INTO fifo_costing_history (id, fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, material_id, batch_id, fifo_sequence, plant_id,
       organization_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, sub_tenant_id)
SELECT 2112817362120904705, 0, 1, 1, 2037082991951757314, 2064203427168768001,
       CAST((SELECT COALESCE(MAX(CAST(f.fifo_sequence AS UNSIGNED)), 0) + 1 FROM fifo_costing_history f WHERE f.tenant_id = '836238' AND f.material_id = 2037082991951757314
              AND f.batch_id = 2064203427168768001 AND f.plant_id = 2013095023495737345 AND f.organization_id = '1971187973669224450' AND f.is_deleted = 0) AS CHAR),
       2013095023495737345, '1971187973669224450', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904704);
INSERT INTO inventory_movement (id, transaction_type, trx_no, inventory_category, parent_trx_no, movement, batch_status, unit_price, total_price, quantity,
       base_qty, uom_id, base_uom_id, item_id, bin_location_id, batch_number_id, costing_method_id, create_user, create_dept, create_time, update_user,
       update_time, is_deleted, tenant_id, plant_id, organization_id, doc_date, manufacturing_date, expired_date, sub_tenant_id, actual_qty, actual_base_qty,
       handling_unit_id)
SELECT 2112817362120904704, 'GDL-R', 'JO-01054', 'Unrestricted', 'SO-01119', 'IN', '', 0, 0, 1,
       1, 2037063096825634821, 2037063096825634821, 2037082991951757314, 2031936537033715714, 2064203427168768001, 'First In First Out', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345,
       CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', 2013095023495737345, '1971187973669224450', '2026-10-14 00:00:00', NULL, NULL, NULL, 1, 1,
       NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904704);

-- JO-01054: item 2037083202254159897 batch 2064201918834135041 bin 2031936537033715714: +1 Unrestricted at 0
UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064201919098376193 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904706);
UPDATE item_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064201919249371138 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904706);
INSERT INTO fifo_costing_history (id, fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, material_id, batch_id, fifo_sequence, plant_id,
       organization_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, sub_tenant_id)
SELECT 2112817362120904707, 0, 1, 1, 2037083202254159897, 2064201918834135041,
       CAST((SELECT COALESCE(MAX(CAST(f.fifo_sequence AS UNSIGNED)), 0) + 1 FROM fifo_costing_history f WHERE f.tenant_id = '836238' AND f.material_id = 2037083202254159897
              AND f.batch_id = 2064201918834135041 AND f.plant_id = 2013095023495737345 AND f.organization_id = '1971187973669224450' AND f.is_deleted = 0) AS CHAR),
       2013095023495737345, '1971187973669224450', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904706);
INSERT INTO inventory_movement (id, transaction_type, trx_no, inventory_category, parent_trx_no, movement, batch_status, unit_price, total_price, quantity,
       base_qty, uom_id, base_uom_id, item_id, bin_location_id, batch_number_id, costing_method_id, create_user, create_dept, create_time, update_user,
       update_time, is_deleted, tenant_id, plant_id, organization_id, doc_date, manufacturing_date, expired_date, sub_tenant_id, actual_qty, actual_base_qty,
       handling_unit_id)
SELECT 2112817362120904706, 'GDL-R', 'JO-01054', 'Unrestricted', 'SO-01119', 'IN', '', 0, 0, 1,
       1, 2037063096825634821, 2037063096825634821, 2037083202254159897, 2031936537033715714, 2064201918834135041, 'First In First Out', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345,
       CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', 2013095023495737345, '1971187973669224450', '2026-10-14 00:00:00', NULL, NULL, NULL, 1, 1,
       NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904706);

-- JO-01054: item 2037082866315575310 batch 2064201910860763138 bin 2031936537033715714: +1 Unrestricted at 0
UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064201911150170114 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904708);
UPDATE item_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064201911322136577 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904708);
INSERT INTO fifo_costing_history (id, fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, material_id, batch_id, fifo_sequence, plant_id,
       organization_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, sub_tenant_id)
SELECT 2112817362120904709, 0, 1, 1, 2037082866315575310, 2064201910860763138,
       CAST((SELECT COALESCE(MAX(CAST(f.fifo_sequence AS UNSIGNED)), 0) + 1 FROM fifo_costing_history f WHERE f.tenant_id = '836238' AND f.material_id = 2037082866315575310
              AND f.batch_id = 2064201910860763138 AND f.plant_id = 2013095023495737345 AND f.organization_id = '1971187973669224450' AND f.is_deleted = 0) AS CHAR),
       2013095023495737345, '1971187973669224450', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904708);
INSERT INTO inventory_movement (id, transaction_type, trx_no, inventory_category, parent_trx_no, movement, batch_status, unit_price, total_price, quantity,
       base_qty, uom_id, base_uom_id, item_id, bin_location_id, batch_number_id, costing_method_id, create_user, create_dept, create_time, update_user,
       update_time, is_deleted, tenant_id, plant_id, organization_id, doc_date, manufacturing_date, expired_date, sub_tenant_id, actual_qty, actual_base_qty,
       handling_unit_id)
SELECT 2112817362120904708, 'GDL-R', 'JO-01054', 'Unrestricted', 'SO-01119', 'IN', '', 0, 0, 1,
       1, 2037063096825634821, 2037063096825634821, 2037082866315575310, 2031936537033715714, 2064201910860763138, 'First In First Out', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345,
       CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', 2013095023495737345, '1971187973669224450', '2026-10-14 00:00:00', NULL, NULL, NULL, 1, 1,
       NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904708);

-- JO-01054: item 2037082702976794639 batch 2064203417773527041 bin 2031936537033715714: +1 Unrestricted at 0
UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064203418062934017 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904710);
UPDATE item_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064203418230706177 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904710);
INSERT INTO fifo_costing_history (id, fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, material_id, batch_id, fifo_sequence, plant_id,
       organization_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, sub_tenant_id)
SELECT 2112817362120904711, 0, 1, 1, 2037082702976794639, 2064203417773527041,
       CAST((SELECT COALESCE(MAX(CAST(f.fifo_sequence AS UNSIGNED)), 0) + 1 FROM fifo_costing_history f WHERE f.tenant_id = '836238' AND f.material_id = 2037082702976794639
              AND f.batch_id = 2064203417773527041 AND f.plant_id = 2013095023495737345 AND f.organization_id = '1971187973669224450' AND f.is_deleted = 0) AS CHAR),
       2013095023495737345, '1971187973669224450', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904710);
INSERT INTO inventory_movement (id, transaction_type, trx_no, inventory_category, parent_trx_no, movement, batch_status, unit_price, total_price, quantity,
       base_qty, uom_id, base_uom_id, item_id, bin_location_id, batch_number_id, costing_method_id, create_user, create_dept, create_time, update_user,
       update_time, is_deleted, tenant_id, plant_id, organization_id, doc_date, manufacturing_date, expired_date, sub_tenant_id, actual_qty, actual_base_qty,
       handling_unit_id)
SELECT 2112817362120904710, 'GDL-R', 'JO-01054', 'Unrestricted', 'SO-01119', 'IN', '', 0, 0, 1,
       1, 2037063096825634821, 2037063096825634821, 2037082702976794639, 2031936537033715714, 2064203417773527041, 'First In First Out', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345,
       CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', 2013095023495737345, '1971187973669224450', '2026-10-14 00:00:00', NULL, NULL, NULL, 1, 1,
       NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904710);

-- JO-01069: item 2037083307329863684 batch 2064203461574643713 bin 2031936537033715714: +2 Unrestricted at 0
UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty + 2, balance_quantity = balance_quantity + 2, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064203461826301954 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904712);
UPDATE item_balance SET unrestricted_qty = unrestricted_qty + 2, balance_quantity = balance_quantity + 2, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064203461989879810 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904712);
INSERT INTO fifo_costing_history (id, fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, material_id, batch_id, fifo_sequence, plant_id,
       organization_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, sub_tenant_id)
SELECT 2112817362120904713, 0, 2, 2, 2037083307329863684, 2064203461574643713,
       CAST((SELECT COALESCE(MAX(CAST(f.fifo_sequence AS UNSIGNED)), 0) + 1 FROM fifo_costing_history f WHERE f.tenant_id = '836238' AND f.material_id = 2037083307329863684
              AND f.batch_id = 2064203461574643713 AND f.plant_id = 2013095023495737345 AND f.organization_id = '1971187973669224450' AND f.is_deleted = 0) AS CHAR),
       2013095023495737345, '1971187973669224450', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904712);
INSERT INTO inventory_movement (id, transaction_type, trx_no, inventory_category, parent_trx_no, movement, batch_status, unit_price, total_price, quantity,
       base_qty, uom_id, base_uom_id, item_id, bin_location_id, batch_number_id, costing_method_id, create_user, create_dept, create_time, update_user,
       update_time, is_deleted, tenant_id, plant_id, organization_id, doc_date, manufacturing_date, expired_date, sub_tenant_id, actual_qty, actual_base_qty,
       handling_unit_id)
SELECT 2112817362120904712, 'GDL-R', 'JO-01069', 'Unrestricted', 'CS-02140', 'IN', '', 0, 0, 2,
       2, 2037063096825634821, 2037063096825634821, 2037083307329863684, 2031936537033715714, 2064203461574643713, 'First In First Out', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345,
       CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', 2013095023495737345, '1971187973669224450', '2026-10-15 00:00:00', NULL, NULL, NULL, 2, 2,
       NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904712);

-- JO-01069: item 2064165435541131265 batch 2064201900387586049 bin 2031936537033715714: +1 Unrestricted at 0
UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064201900651827201 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904714);
UPDATE item_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064201900802822145 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904714);
INSERT INTO fifo_costing_history (id, fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, material_id, batch_id, fifo_sequence, plant_id,
       organization_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, sub_tenant_id)
SELECT 2112817362120904715, 0, 1, 1, 2064165435541131265, 2064201900387586049,
       CAST((SELECT COALESCE(MAX(CAST(f.fifo_sequence AS UNSIGNED)), 0) + 1 FROM fifo_costing_history f WHERE f.tenant_id = '836238' AND f.material_id = 2064165435541131265
              AND f.batch_id = 2064201900387586049 AND f.plant_id = 2013095023495737345 AND f.organization_id = '1971187973669224450' AND f.is_deleted = 0) AS CHAR),
       2013095023495737345, '1971187973669224450', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904714);
INSERT INTO inventory_movement (id, transaction_type, trx_no, inventory_category, parent_trx_no, movement, batch_status, unit_price, total_price, quantity,
       base_qty, uom_id, base_uom_id, item_id, bin_location_id, batch_number_id, costing_method_id, create_user, create_dept, create_time, update_user,
       update_time, is_deleted, tenant_id, plant_id, organization_id, doc_date, manufacturing_date, expired_date, sub_tenant_id, actual_qty, actual_base_qty,
       handling_unit_id)
SELECT 2112817362120904714, 'GDL-R', 'JO-01069', 'Unrestricted', 'CS-02140', 'IN', '', 0, 0, 1,
       1, 2037063096825634821, 2037063096825634821, 2064165435541131265, 2031936537033715714, 2064201900387586049, 'First In First Out', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345,
       CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', 2013095023495737345, '1971187973669224450', '2026-10-15 00:00:00', NULL, NULL, NULL, 1, 1,
       NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904714);

-- JO-01069: item 2037082702976794639 batch 2064203417773527041 bin 2031936537033715714: +1 Unrestricted at 0
UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064203418062934017 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904716);
UPDATE item_balance SET unrestricted_qty = unrestricted_qty + 1, balance_quantity = balance_quantity + 1, update_user = 2031950952575545345, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '836238' AND id = 2064203418230706177 AND is_deleted = 0 AND NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904716);
INSERT INTO fifo_costing_history (id, fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, material_id, batch_id, fifo_sequence, plant_id,
       organization_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, sub_tenant_id)
SELECT 2112817362120904717, 0, 1, 1, 2037082702976794639, 2064203417773527041,
       CAST((SELECT COALESCE(MAX(CAST(f.fifo_sequence AS UNSIGNED)), 0) + 1 FROM fifo_costing_history f WHERE f.tenant_id = '836238' AND f.material_id = 2037082702976794639
              AND f.batch_id = 2064203417773527041 AND f.plant_id = 2013095023495737345 AND f.organization_id = '1971187973669224450' AND f.is_deleted = 0) AS CHAR),
       2013095023495737345, '1971187973669224450', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904716);
INSERT INTO inventory_movement (id, transaction_type, trx_no, inventory_category, parent_trx_no, movement, batch_status, unit_price, total_price, quantity,
       base_qty, uom_id, base_uom_id, item_id, bin_location_id, batch_number_id, costing_method_id, create_user, create_dept, create_time, update_user,
       update_time, is_deleted, tenant_id, plant_id, organization_id, doc_date, manufacturing_date, expired_date, sub_tenant_id, actual_qty, actual_base_qty,
       handling_unit_id)
SELECT 2112817362120904716, 'GDL-R', 'JO-01069', 'Unrestricted', 'CS-02140', 'IN', '', 0, 0, 1,
       1, 2037063096825634821, 2037063096825634821, 2037082702976794639, 2031936537033715714, 2064203417773527041, 'First In First Out', 2031950952575545345, 2013095023495737345, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2031950952575545345,
       CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '836238', 2013095023495737345, '1971187973669224450', '2026-10-15 00:00:00', NULL, NULL, NULL, 1, 1,
       NULL
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904716);

COMMIT;

-- ========== AFTER (read-only) ==========

-- A1: 1 row: 7 | 7
SELECT (SELECT COUNT(*) FROM inventory_movement WHERE id IN (2112817362120904704, 2112817362120904706, 2112817362120904708, 2112817362120904710, 2112817362120904712, 2112817362120904714, 2112817362120904716)) AS movements,
       (SELECT COUNT(*) FROM fifo_costing_history WHERE id IN (2112817362120904705, 2112817362120904707, 2112817362120904709, 2112817362120904711, 2112817362120904713, 2112817362120904715, 2112817362120904717)) AS layers;

-- A2: 6 rows; fifo_available = balance_quantity again; unrestricted_qty and balance_quantity = B2 + …794639/…527041 +2, …575310/…763138 +1, …757314/…768001 +1, …159897/…135041 +1, …863684/…643713 +2, …131265/…586049 +1 (other deliveries in between move them too)
SELECT CAST(b.material_id AS CHAR) AS item, CAST(b.batch_id AS CHAR) AS batch, b.unrestricted_qty, b.balance_quantity,
       (SELECT SUM(f.fifo_available_quantity) FROM fifo_costing_history f WHERE f.tenant_id = b.tenant_id AND f.material_id = b.material_id
          AND f.batch_id = b.batch_id AND f.plant_id = b.plant_id AND f.is_deleted = 0) AS fifo_available
  FROM item_batch_balance b WHERE b.tenant_id = '836238' AND b.id IN (2064201900651827201, 2064201911150170114, 2064201919098376193, 2064203418062934017, 2064203427424620546, 2064203461826301954) ORDER BY b.material_id, b.batch_id;

-- A3: 6 rows; the sums match again; unrestricted_qty and balance_quantity = B3 + …794639 +2, …575310 +1, …757314 +1, …159897 +1, …863684 +2, …131265 +1
SELECT CAST(i.material_id AS CHAR) AS item, i.unrestricted_qty, i.balance_quantity,
       (SELECT SUM(b.unrestricted_qty) FROM item_batch_balance b WHERE b.tenant_id = i.tenant_id AND b.material_id = i.material_id
          AND b.location_id = i.location_id AND b.plant_id = i.plant_id AND b.is_deleted = 0) AS batches_unrestricted,
       (SELECT SUM(b.balance_quantity) FROM item_batch_balance b WHERE b.tenant_id = i.tenant_id AND b.material_id = i.material_id
          AND b.location_id = i.location_id AND b.plant_id = i.plant_id AND b.is_deleted = 0) AS batches_balance
  FROM item_balance i WHERE i.tenant_id = '836238' AND i.id IN (2064201900802822145, 2064201911322136577, 2064201919249371138, 2064203418230706177, 2064203427575615489, 2064203461989879810) ORDER BY i.material_id;

-- A4: 7 rows (the new FIFO layers): fifo_sequence 2, 2, 2, 2, 2, 2, 3; initial = available = 1, 1, 1, 1, 2, 1, 1; cost 0, 0, 0, 0, 0, 0, 0
SELECT CAST(material_id AS CHAR) AS item, CAST(batch_id AS CHAR) AS batch, fifo_sequence, fifo_initial_quantity, fifo_available_quantity, fifo_cost_price
  FROM fifo_costing_history WHERE id IN (2112817362120904705, 2112817362120904707, 2112817362120904709, 2112817362120904711, 2112817362120904713, 2112817362120904715, 2112817362120904717) ORDER BY id;

-- A5: 7 rows (the new movements): JO-01054 …757314 +1, JO-01054 …159897 +1, JO-01054 …575310 +1, JO-01054 …794639 +1, JO-01069 …863684 +2, JO-01069 …131265 +1, JO-01069 …794639 +1; GDL-R | IN | Unrestricted; doc_date = the revert's day
SELECT trx_no, transaction_type, movement, inventory_category, CAST(item_id AS CHAR) AS item, CAST(batch_number_id AS CHAR) AS batch, base_qty, unit_price, doc_date
  FROM inventory_movement WHERE id IN (2112817362120904704, 2112817362120904706, 2112817362120904708, 2112817362120904710, 2112817362120904712, 2112817362120904714, 2112817362120904716) ORDER BY id;

-- ========== ROLLBACK (only to undo the repair: uncomment and run this block) ==========
-- Undoes a key only while its new FIFO layer is untouched (nothing consumed from it yet); a key already consumed stays.

-- START TRANSACTION;
--
-- -- JO-01054: item 2037082991951757314 batch 2064203427168768001: -1
-- UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064203427424620546 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904704) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904705 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- UPDATE item_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064203427575615489 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904704) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904705 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- DELETE FROM fifo_costing_history WHERE tenant_id = '836238' AND id = 2112817362120904705 AND fifo_available_quantity = fifo_initial_quantity;
-- DELETE FROM inventory_movement WHERE tenant_id = '836238' AND id = 2112817362120904704 AND NOT EXISTS (SELECT 1 FROM fifo_costing_history z WHERE z.id = 2112817362120904705);
--
-- -- JO-01054: item 2037083202254159897 batch 2064201918834135041: -1
-- UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064201919098376193 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904706) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904707 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- UPDATE item_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064201919249371138 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904706) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904707 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- DELETE FROM fifo_costing_history WHERE tenant_id = '836238' AND id = 2112817362120904707 AND fifo_available_quantity = fifo_initial_quantity;
-- DELETE FROM inventory_movement WHERE tenant_id = '836238' AND id = 2112817362120904706 AND NOT EXISTS (SELECT 1 FROM fifo_costing_history z WHERE z.id = 2112817362120904707);
--
-- -- JO-01054: item 2037082866315575310 batch 2064201910860763138: -1
-- UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064201911150170114 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904708) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904709 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- UPDATE item_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064201911322136577 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904708) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904709 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- DELETE FROM fifo_costing_history WHERE tenant_id = '836238' AND id = 2112817362120904709 AND fifo_available_quantity = fifo_initial_quantity;
-- DELETE FROM inventory_movement WHERE tenant_id = '836238' AND id = 2112817362120904708 AND NOT EXISTS (SELECT 1 FROM fifo_costing_history z WHERE z.id = 2112817362120904709);
--
-- -- JO-01054: item 2037082702976794639 batch 2064203417773527041: -1
-- UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064203418062934017 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904710) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904711 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- UPDATE item_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064203418230706177 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904710) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904711 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- DELETE FROM fifo_costing_history WHERE tenant_id = '836238' AND id = 2112817362120904711 AND fifo_available_quantity = fifo_initial_quantity;
-- DELETE FROM inventory_movement WHERE tenant_id = '836238' AND id = 2112817362120904710 AND NOT EXISTS (SELECT 1 FROM fifo_costing_history z WHERE z.id = 2112817362120904711);
--
-- -- JO-01069: item 2037083307329863684 batch 2064203461574643713: -2
-- UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty - 2, balance_quantity = balance_quantity - 2, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064203461826301954 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904712) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904713 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- UPDATE item_balance SET unrestricted_qty = unrestricted_qty - 2, balance_quantity = balance_quantity - 2, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064203461989879810 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904712) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904713 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- DELETE FROM fifo_costing_history WHERE tenant_id = '836238' AND id = 2112817362120904713 AND fifo_available_quantity = fifo_initial_quantity;
-- DELETE FROM inventory_movement WHERE tenant_id = '836238' AND id = 2112817362120904712 AND NOT EXISTS (SELECT 1 FROM fifo_costing_history z WHERE z.id = 2112817362120904713);
--
-- -- JO-01069: item 2064165435541131265 batch 2064201900387586049: -1
-- UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064201900651827201 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904714) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904715 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- UPDATE item_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064201900802822145 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904714) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904715 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- DELETE FROM fifo_costing_history WHERE tenant_id = '836238' AND id = 2112817362120904715 AND fifo_available_quantity = fifo_initial_quantity;
-- DELETE FROM inventory_movement WHERE tenant_id = '836238' AND id = 2112817362120904714 AND NOT EXISTS (SELECT 1 FROM fifo_costing_history z WHERE z.id = 2112817362120904715);
--
-- -- JO-01069: item 2037082702976794639 batch 2064203417773527041: -1
-- UPDATE item_batch_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064203418062934017 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904716) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904717 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- UPDATE item_balance SET unrestricted_qty = unrestricted_qty - 1, balance_quantity = balance_quantity - 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
--  WHERE tenant_id = '836238' AND id = 2064203418230706177 AND EXISTS (SELECT 1 FROM inventory_movement x WHERE x.id = 2112817362120904716) AND EXISTS (SELECT 1 FROM fifo_costing_history y WHERE y.id = 2112817362120904717 AND y.fifo_available_quantity = y.fifo_initial_quantity);
-- DELETE FROM fifo_costing_history WHERE tenant_id = '836238' AND id = 2112817362120904717 AND fifo_available_quantity = fifo_initial_quantity;
-- DELETE FROM inventory_movement WHERE tenant_id = '836238' AND id = 2112817362120904716 AND NOT EXISTS (SELECT 1 FROM fifo_costing_history z WHERE z.id = 2112817362120904717);
--
-- COMMIT;
