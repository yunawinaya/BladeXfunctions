-- Prod repair 2026-10-23: stock balance rows whose unit is the item's base unit under another record (same name ignoring
-- capitals: kg vs KG, pkt vs PKT, or two units both named CA*24). V2 (GD_BULK_PREPARE + the inventory engine) compares unit
-- records, so these items cannot be delivered through V2. Classic never compared them, so the quantities are already in the
-- base unit: only the unit reference changes, no quantity. Tenants 528521 (Kenhin) and 073522 only.
-- On 10-23: item_balance 528521 16 rows + 073522 10 rows, item_batch_balance 073522 10 rows (36).
-- The case-only condition is re-checked when it runs: a base unit changed since (Kenhin edits them by hand) adjusts or
-- drops the row, and a second run changes nothing.

-- 1. preview
SELECT b.tenant_id, 'item_balance' AS tbl, CAST(b.id AS CHAR) AS row_id, i.material_code, CAST(b.location_id AS CHAR) AS location_id,
       mu.uom_name AS unit_now, bu.uom_name AS unit_after, b.unrestricted_qty, b.reserved_qty
  FROM item_balance b
  JOIN item i ON i.id = b.material_id
  JOIN unit_of_measurement mu ON mu.id = b.material_uom
  JOIN unit_of_measurement bu ON bu.id = i.based_uom
 WHERE b.tenant_id IN ('528521', '073522') AND b.is_deleted = 0 AND i.is_deleted = 0
   AND b.material_uom <> i.based_uom
   AND LOWER(TRIM(mu.uom_name)) = LOWER(TRIM(bu.uom_name)) COLLATE utf8mb4_bin
UNION ALL
SELECT b.tenant_id, 'item_batch_balance', CAST(b.id AS CHAR), i.material_code, CAST(b.location_id AS CHAR),
       mu.uom_name, bu.uom_name, b.unrestricted_qty, b.reserved_qty
  FROM item_batch_balance b
  JOIN item i ON i.id = b.material_id
  JOIN unit_of_measurement mu ON mu.id = b.material_uom
  JOIN unit_of_measurement bu ON bu.id = i.based_uom
 WHERE b.tenant_id IN ('528521', '073522') AND b.is_deleted = 0 AND i.is_deleted = 0
   AND b.material_uom <> i.based_uom
   AND LOWER(TRIM(mu.uom_name)) = LOWER(TRIM(bu.uom_name)) COLLATE utf8mb4_bin;

-- 2. update (the same rows)
UPDATE item_balance b
  JOIN item i ON i.id = b.material_id
  JOIN unit_of_measurement mu ON mu.id = b.material_uom
  JOIN unit_of_measurement bu ON bu.id = i.based_uom
   SET b.material_uom = i.based_uom
 WHERE b.tenant_id IN ('528521', '073522') AND b.is_deleted = 0 AND i.is_deleted = 0
   AND b.material_uom <> i.based_uom
   AND LOWER(TRIM(mu.uom_name)) = LOWER(TRIM(bu.uom_name)) COLLATE utf8mb4_bin;

UPDATE item_batch_balance b
  JOIN item i ON i.id = b.material_id
  JOIN unit_of_measurement mu ON mu.id = b.material_uom
  JOIN unit_of_measurement bu ON bu.id = i.based_uom
   SET b.material_uom = i.based_uom
 WHERE b.tenant_id IN ('528521', '073522') AND b.is_deleted = 0 AND i.is_deleted = 0
   AND b.material_uom <> i.based_uom
   AND LOWER(TRIM(mu.uom_name)) = LOWER(TRIM(bu.uom_name)) COLLATE utf8mb4_bin;

-- 3. check: the preview above returns no rows
