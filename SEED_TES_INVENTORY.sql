-- ============================================================================
-- Seed TES412-TES511 (100 items) into inventory for ASAI          [DEV ONLY]
-- ----------------------------------------------------------------------------
-- Creates 37 new items TES475-TES511 cloned from the TES412-TES474 block, then
-- gives all 100 items 1000 unrestricted at ASAI HQ / A1-B1, each with a FIFO
-- costing layer and an OP inventory_movement entry.
--
-- PRIVILEGES: needs INSERT on bladex_boot. The `sudu-ai-agent` account used by
-- .dbtools/db has only SELECT+UPDATE, so run this with an admin login.
--
-- Every section is guarded by NOT EXISTS, so the script is safe to re-run:
-- a second run inserts nothing. No DDL and no temporary tables are used.
--
-- Run inside the transaction, check the four counts at the bottom, then COMMIT.
-- ============================================================================

-- Every string column in the six tables below is utf8mb4_general_ci. Literals,
-- user variables and derived-table columns inherit the CONNECTION collation
-- instead, so a client connected as utf8mb4_unicode_ci (Beekeeper's default)
-- fails with "Illegal mix of collations". Pin the session to match the columns.
SET NAMES 'utf8mb4' COLLATE 'utf8mb4_general_ci';

START TRANSACTION;

-- ---------------------------------------------------------------- parameters
SET @org    = '1123598813738675201';   -- ASAI
SET @tenant = '000000';
SET @plant  = 1123598813738675202;     -- ASAI HQ
SET @bin    = 2018912822846582786;     -- A1-B1 (the bin every existing TES balance uses)
SET @uom    = 2018906563477008392;     -- base UOM of the TES block
SET @cat    = 2018905941675634689;     -- item_category of the TES block
SET @user   = 2033377157663899650;     -- create_user on the TES block
SET @qty    = 1000;                    -- unrestricted qty per item
SET @cost   = 1.0000;                  -- FIFO layer cost price (matches existing OP rows)
SET @lo     = 412;                     -- TES number range to stock, inclusive
SET @hi     = 511;
SET @now    = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00');  -- these columns are UTC+8
SET @trx_no = CONCAT('OP-', DATE_FORMAT(@now, '%Y%m%d'), '-900');

SET @item_base = (SELECT MAX(id) FROM item);
SET @uuid_base = (SELECT MAX(CAST(item_uuid AS UNSIGNED)) FROM item
                  WHERE organization_id = @org AND item_uuid REGEXP '^[0-9]+$');

-- ============================================================================
-- 1. Create the 37 new items (TES475-TES511)
-- ============================================================================
INSERT INTO item (
  id, is_active, material_type, material_code, material_name, material_desc,
  material_costing_method, stock_control, based_uom, item_category,
  purchase_unit_price, sales_unit_price, assembly_cost, reorder_quantity, irbm_id,
  over_receive_tolerance, under_receive_tolerance,
  over_delivery_tolerance, under_delivery_tolerance,
  min_purchase_qty, min_sales_qty, net_weight, gross_weight,
  is_base, auto_bom, item_properties, serial_no_generate_rule,
  item_batch_management, serial_number_management,
  business_scope, custom_7u3don4k, custom_fields, material_code_type, item_uuid,
  posted_status, posted_date,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, organization_id
)
SELECT
  @item_base + t.seq, 1, 'Goods', t.material_code, t.material_name,
  CONCAT(t.material_name, ' finish'),
  'First In First Out', 1, @uom, @cat,
  0.0000, 0.0000, 0.00, 1, '022',
  0.00, 0.00,
  0.00, 0.00,
  0.000, 0.000, 0.000, 0.000,
  'True', 1, 'Default', 'According To System Settings',
  0, 0,
  '["1", "2", "3"]', '{}', '{}', -9999, CAST(@uuid_base + t.seq AS CHAR),
  'Posted', @now,
  @user, @org, @now, @user, @now,
  0, @tenant, @org
FROM (
            SELECT  1 AS seq, 'TES475' AS material_code, 'Camshaft with Nickel Plating'               AS material_name
  UNION ALL SELECT  2, 'TES476', 'Crankshaft with Carbon Fiber'
  UNION ALL SELECT  3, 'TES477', 'Flywheel with Teflon Coating'
  UNION ALL SELECT  4, 'TES478', 'Radiator with Brass Fitting'
  UNION ALL SELECT  5, 'TES479', 'Thermostat with EPDM Seal'
  UNION ALL SELECT  6, 'TES480', 'Water Pump with Bronze Bushing'
  UNION ALL SELECT  7, 'TES481', 'Oil Filter with Nitrile Gasket'
  UNION ALL SELECT  8, 'TES482', 'Fuel Injector with Ceramic Tile'
  UNION ALL SELECT  9, 'TES483', 'Spark Plug with Iridium Tip'
  UNION ALL SELECT 10, 'TES484', 'Ignition Coil with Copper Foil'
  UNION ALL SELECT 11, 'TES485', 'Timing Belt with Kevlar Weave'
  UNION ALL SELECT 12, 'TES486', 'Tensioner with Zinc Plating'
  UNION ALL SELECT 13, 'TES487', 'Rocker Arm with Titanium Rod'
  UNION ALL SELECT 14, 'TES488', 'Valve Spring with Chrome Plating'
  UNION ALL SELECT 15, 'TES489', 'Cylinder Head with Anodized Aluminum'
  UNION ALL SELECT 16, 'TES490', 'Piston Ring with Molybdenum Coating'
  UNION ALL SELECT 17, 'TES491', 'Connecting Rod with Forged Steel'
  UNION ALL SELECT 18, 'TES492', 'Main Bearing with Babbitt Lining'
  UNION ALL SELECT 19, 'TES493', 'Oil Pan with Powder Coated Steel'
  UNION ALL SELECT 20, 'TES494', 'Turbocharger with Inconel Housing'
  UNION ALL SELECT 21, 'TES495', 'Intercooler with Aluminum Extrusion'
  UNION ALL SELECT 22, 'TES496', 'Throttle Body with PA66 Bearing'
  UNION ALL SELECT 23, 'TES497', 'Mass Air Flow Sensor with Silver Wire'
  UNION ALL SELECT 24, 'TES498', 'Oxygen Sensor with Platinum Element'
  UNION ALL SELECT 25, 'TES499', 'Catalytic Converter with Ceramic Substrate'
  UNION ALL SELECT 26, 'TES500', 'Muffler with Stainless Steel Tube'
  UNION ALL SELECT 27, 'TES501', 'Exhaust Manifold with Cast Iron'
  UNION ALL SELECT 28, 'TES502', 'EGR Valve with Viton O-Ring'
  UNION ALL SELECT 29, 'TES503', 'Vacuum Pump with PTFE Gasket'
  UNION ALL SELECT 30, 'TES504', 'Brake Rotor with Carbon Ceramic'
  UNION ALL SELECT 31, 'TES505', 'Brake Pad with Sintered Metal'
  UNION ALL SELECT 32, 'TES506', 'Master Cylinder with Neoprene Rubber'
  UNION ALL SELECT 33, 'TES507', 'Wheel Hub with Galvanized Iron'
  UNION ALL SELECT 34, 'TES508', 'CV Joint with Molykote Grease'
  UNION ALL SELECT 35, 'TES509', 'Drive Shaft with Alloy Wheel'
  UNION ALL SELECT 36, 'TES510', 'Differential with POM Gear'
  UNION ALL SELECT 37, 'TES511', 'Transfer Case with Magnesium Alloy'
) t
WHERE NOT EXISTS (
  -- explicit COLLATE wins over the session setting regardless of client
  SELECT 1 FROM item x
  WHERE x.material_code = t.material_code COLLATE utf8mb4_general_ci
    AND x.organization_id = @org
);

-- ============================================================================
-- 2. UOM Conversion subform - identity 1:1 row, required for a usable item
--    (no-op for TES412-TES474, which already have theirs)
-- ============================================================================
SET @conv_base = (SELECT MAX(id) FROM item_mji552rc_sub);
INSERT INTO item_mji552rc_sub (
  id, Item_id, alt_qty, alt_uom_id, text_b4j8h211, base_qty, base_uom_id,
  purchase_unit_price, purchase_max_price, purchase_min_price,
  sales_unit_price, sales_max_price, sales_min_price, sales_price_1,
  over_delivery_tolerance, over_receive_tolerance,
  purchase_default_uom, sales_default_uom,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, sub_tenant_id
)
SELECT
  @conv_base + t.seq, t.item_id, 1.000000, t.based_uom, '=', 1.000000, t.based_uom,
  0.0000, 0.0000, 0.0000,
  0.0000, 0.0000, 0.0000, 0.0000,
  0.00, 0.00,
  0, 0,
  @user, @org, @now, @user, @now,
  0, @tenant, 0
FROM (
  SELECT i.id AS item_id, i.based_uom,
         ROW_NUMBER() OVER (ORDER BY CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED)) AS seq
  FROM item i
  WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
    AND i.material_code REGEXP '^TES[0-9]+$'
    AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi
    AND NOT EXISTS (SELECT 1 FROM item_mji552rc_sub s
                    WHERE s.Item_id = i.id AND s.is_deleted = 0)
) t;

-- ============================================================================
-- 3. Packing Detail subform - identity 1:1 row
-- ============================================================================
SET @pack_base = (SELECT MAX(id) FROM item_vabbbwt2_sub);
INSERT INTO item_vabbbwt2_sub (
  id, Item_id, packing_qty, packing_uom_id, text_b4j8h211, quantity, uom_id,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, sub_tenant_id
)
SELECT
  @pack_base + t.seq, t.item_id, 1.000000, t.based_uom, '=', 1.000000, t.based_uom,
  @user, @org, @now, @user, @now,
  0, @tenant, 0
FROM (
  SELECT i.id AS item_id, i.based_uom,
         ROW_NUMBER() OVER (ORDER BY CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED)) AS seq
  FROM item i
  WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
    AND i.material_code REGEXP '^TES[0-9]+$'
    AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi
    AND NOT EXISTS (SELECT 1 FROM item_vabbbwt2_sub s
                    WHERE s.Item_id = i.id AND s.is_deleted = 0)
) t;

-- ============================================================================
-- 4. item_balance - 1000 unrestricted at ASAI HQ / A1-B1
-- ============================================================================
SET @bal_base = (SELECT MAX(id) FROM item_balance);
INSERT INTO item_balance (
  id, material_id, material_uom, location_id, plant_id,
  block_qty, reserved_qty, unrestricted_qty, qualityinsp_qty, intransit_qty,
  balance_quantity,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, organization_id
)
SELECT
  @bal_base + t.seq, t.item_id, t.based_uom, @bin, @plant,
  0.000, 0.000, @qty, 0.000, 0.000,
  @qty,
  @user, @org, @now, @user, @now,
  0, @tenant, @org
FROM (
  SELECT i.id AS item_id, i.based_uom,
         ROW_NUMBER() OVER (ORDER BY CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED)) AS seq
  FROM item i
  WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
    AND i.material_code REGEXP '^TES[0-9]+$'
    AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi
    AND NOT EXISTS (SELECT 1 FROM item_balance b
                    WHERE b.material_id = i.id AND b.plant_id = @plant
                      AND b.location_id = @bin AND b.is_deleted = 0)
) t;

-- ============================================================================
-- 5. fifo_costing_history - one layer per item (these items are FIFO, so a
--    delivery with no layer to consume would break costing)
-- ============================================================================
SET @fifo_base = (SELECT MAX(id) FROM fifo_costing_history);
INSERT INTO fifo_costing_history (
  id, material_id, batch_id,
  fifo_cost_price, fifo_initial_quantity, fifo_available_quantity, fifo_sequence,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, plant_id, organization_id
)
SELECT
  @fifo_base + t.seq, t.item_id, NULL,
  @cost, @qty, @qty, CAST(t.next_seq AS CHAR),
  @user, @org, @now, @user, @now,
  0, @tenant, @plant, @org
FROM (
  SELECT i.id AS item_id,
         ROW_NUMBER() OVER (ORDER BY CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED)) AS seq,
         COALESCE((SELECT MAX(CAST(f.fifo_sequence AS UNSIGNED))
                   FROM fifo_costing_history f
                   WHERE f.material_id = i.id AND f.plant_id = @plant
                     AND f.is_deleted = 0), 0) + 1 AS next_seq
  FROM item i
  WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
    AND i.material_code REGEXP '^TES[0-9]+$'
    AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi
    AND NOT EXISTS (SELECT 1 FROM fifo_costing_history f
                    WHERE f.material_id = i.id AND f.plant_id = @plant
                      AND f.is_deleted = 0)
) t;

-- ============================================================================
-- 6. inventory_movement - OP / IN / Unrestricted, matching the existing
--    opening-balance rows in this org
-- ============================================================================
SET @mov_base = (SELECT MAX(id) FROM inventory_movement);
INSERT INTO inventory_movement (
  id, transaction_type, trx_no, parent_trx_no, movement, inventory_category,
  batch_status, unit_price, total_price, quantity, base_qty,
  actual_qty, actual_base_qty,
  uom_id, base_uom_id, item_id, bin_location_id, batch_number_id,
  costing_method_id, doc_date,
  create_user, create_dept, create_time, update_user, update_time,
  is_deleted, tenant_id, plant_id, organization_id
)
SELECT
  @mov_base + t.seq, 'OP', @trx_no, '', 'IN', 'Unrestricted',
  '', @cost, @cost * @qty, @qty, @qty,
  @qty, @qty,
  t.based_uom, t.based_uom, t.item_id, @bin, NULL,
  'First In First Out', DATE(@now),
  @user, @org, @now, @user, @now,
  0, @tenant, @plant, @org
FROM (
  SELECT i.id AS item_id, i.based_uom,
         ROW_NUMBER() OVER (ORDER BY CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED)) AS seq
  FROM item i
  WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
    AND i.material_code REGEXP '^TES[0-9]+$'
    AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi
    AND NOT EXISTS (SELECT 1 FROM inventory_movement m
                    WHERE m.item_id = i.id AND m.trx_no = @trx_no
                      AND m.is_deleted = 0)
) t;

-- ============================================================================
-- 7. Verify, then COMMIT (all four counts must be 100)
-- ============================================================================
SELECT
  (SELECT COUNT(*) FROM item i
    WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
      AND i.material_code REGEXP '^TES[0-9]+$'
      AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi) AS items,
  (SELECT COUNT(*) FROM item i
     JOIN item_balance b ON b.material_id = i.id AND b.is_deleted = 0
                        AND b.plant_id = @plant AND b.location_id = @bin
    WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
      AND i.material_code REGEXP '^TES[0-9]+$'
      AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi) AS balances,
  (SELECT COUNT(*) FROM item i
     JOIN fifo_costing_history f ON f.material_id = i.id AND f.is_deleted = 0
                                AND f.plant_id = @plant
    WHERE i.organization_id = @org AND i.tenant_id = @tenant AND i.is_deleted = 0
      AND i.material_code REGEXP '^TES[0-9]+$'
      AND CAST(SUBSTRING(i.material_code, 4) AS UNSIGNED) BETWEEN @lo AND @hi) AS fifo_layers,
  (SELECT COUNT(*) FROM inventory_movement m
    WHERE m.trx_no = @trx_no AND m.is_deleted = 0) AS movements;

-- COMMIT;      -- <- run this once the four counts read 100
-- ROLLBACK;    -- <- if anything looks wrong
