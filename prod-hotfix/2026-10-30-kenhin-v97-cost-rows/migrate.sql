-- Kenhin (tenant 528521): V97 (Weighted Average) carries only FIFO cost rows, so GD Completed V2 refuses
-- GD/20261030/2341 (UNSUPPORTED_COSTING). Same as classic SUBTRACT_INVENTORY_NEW's "Migrate Costing Incorrect Data":
-- one WA row (the FIFO rows' available quantity at their weighted cost), FIFO rows retired. Built by build.py.
--   V97    FIFO 2058950305406959618, 2102972534688452610 -> WA 2116017246831546368  qty 1000999970.00000000  price 51.94805345

-- PART 1: checks (all must match)
SELECT COUNT(*) AS fifo_rows_to_retire FROM fifo_costing_history
 WHERE tenant_id = '528521' AND is_deleted = 0 AND (id, fifo_available_quantity) IN ((2058950305406959618, 999971.00000000), (2102972534688452610, 999999999.00000000));
--   expect: 2
SELECT COUNT(*) AS wa_rows_already FROM wa_costing_method
 WHERE tenant_id = '528521' AND is_deleted = 0 AND material_id IN (2058889562500812805);
--   expect: 0
SELECT COUNT(*) AS new_id_taken FROM wa_costing_method WHERE id IN (2116017246831546368);
--   expect: 0

-- PART 2: the migration (expected rows affected: 1, then 2)
INSERT INTO wa_costing_method (id, wa_quantity, material_id, batch_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, plant_id, organization_id, updated_at, created_at, wa_cost_price, sub_tenant_id)
SELECT v.* FROM (VALUES
  ROW(2116017246831546368, 1000999970.00000000, 2058889562500812805, NULL, 2006752085990985729, 2006752085806436353, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 2006752085990985729, CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00'), 0, '528521', '2006975338995011586', '2006752085806436353', '', '', 51.94805345, NULL)
) AS v(id, wa_quantity, material_id, batch_id, create_user, create_dept, create_time, update_user, update_time, is_deleted, tenant_id, plant_id, organization_id, updated_at, created_at, wa_cost_price, sub_tenant_id)
WHERE NOT EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = v.tenant_id AND w.material_id = v.material_id
                     AND w.plant_id = v.plant_id AND w.organization_id = v.organization_id AND w.is_deleted = 0)
  AND (SELECT COUNT(*) FROM fifo_costing_history f WHERE f.tenant_id = '528521' AND f.is_deleted = 0 AND (f.id, f.fifo_available_quantity) IN ((2058950305406959618, 999971.00000000), (2102972534688452610, 999999999.00000000))) = 2;

UPDATE fifo_costing_history
   SET is_deleted = 1, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '528521' AND is_deleted = 0 AND (id, fifo_available_quantity) IN ((2058950305406959618, 999971.00000000), (2102972534688452610, 999999999.00000000))
   AND EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = '528521' AND w.id IN (2116017246831546368) AND w.is_deleted = 0);

-- PART 3: after-checks
SELECT CAST(id AS CHAR) id, wa_quantity, wa_cost_price FROM wa_costing_method WHERE tenant_id = '528521' AND id IN (2116017246831546368) AND is_deleted = 0;
--   expect: 2116017246831546368 1000999970.00000000 51.94805345
SELECT COUNT(*) AS fifo_rows_still_active FROM fifo_costing_history WHERE tenant_id = '528521' AND id IN (2058950305406959618, 2102972534688452610) AND is_deleted = 0;
--   expect: 0
