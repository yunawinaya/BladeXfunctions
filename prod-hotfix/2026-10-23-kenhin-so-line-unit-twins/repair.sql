-- Prod repair 2026-10-23, tenant 528521 (Kenhin): open sales order lines whose unit is the item's base unit under another record
-- (same name ignoring capitals: kg vs KG, pkt vs PKT). Kenhin switched these items' base units from kg / pkt to KG / PKT by
-- hand (10-22 and 10-23), which stranded the older lines: with no conversion between the two records, a delivery of them is
-- refused by GD Created V2 (GD_BULK_PREPARE: "no conversion to the base unit") and by the classic save's unit guard.
-- On 10-23 16:10: 307 lines on 270 sales orders, 11 items (B03 203, B05 44, B03-10 20, B06 19, B03-YFC 5, B04 5, B02 4, B16 3,
-- B03-5 2, B05-Econsave 1, B10-Econsave 1), created 06-09 to 09-22. All Issued, nothing planned or delivered, no open GD, no
-- open reservation (2 Cancelled GD reservations only).
-- Only the unit reference changes: the two records are the same unit, so quantities and prices stay as they are. packing_uom
-- moves with it where it is that same unit record (4 lines). The conditions are re-checked when it runs (a base unit switched
-- since is picked up), and a second run changes nothing. Not touched: completed / cancelled lines, delivered history.

-- 0. preview: what will change, per item
SELECT i.material_code, su.uom_name AS unit_now, bu.uom_name AS unit_after, COUNT(*) AS line_count,
       SUM(l.packing_uom = l.so_item_uom) AS packing_uom_too, COUNT(DISTINCT s.id) AS sales_orders
  FROM sales_order_axszx8cj_sub l
  JOIN sales_order s ON s.id = l.sales_order_id
  JOIN item i ON i.id = l.item_name AND i.tenant_id = s.tenant_id
  JOIN unit_of_measurement su ON su.id = l.so_item_uom
  JOIN unit_of_measurement bu ON bu.id = i.based_uom
 WHERE s.tenant_id = '528521' AND s.is_deleted = 0 AND l.is_deleted = 0 AND i.is_deleted = 0
   AND s.so_status IN ('Issued', 'Processing', 'In Progress', 'Partially Delivered')
   AND IFNULL(l.line_status, '') NOT IN ('Completed', 'Cancelled')
   AND l.so_quantity > IFNULL(l.delivered_qty, 0) + IFNULL(l.planned_qty, 0)
   AND l.so_item_uom <> i.based_uom
   AND LOWER(TRIM(su.uom_name)) = LOWER(TRIM(bu.uom_name)) COLLATE utf8mb4_bin
 GROUP BY i.material_code, su.uom_name, bu.uom_name
 ORDER BY line_count DESC;

START TRANSACTION;

-- 1. packing_uom first, where it is the same record as the line's unit (needs the line's unit still unchanged)
UPDATE sales_order_axszx8cj_sub l
  JOIN sales_order s ON s.id = l.sales_order_id
  JOIN item i ON i.id = l.item_name AND i.tenant_id = s.tenant_id
  JOIN unit_of_measurement su ON su.id = l.so_item_uom
  JOIN unit_of_measurement bu ON bu.id = i.based_uom
   SET l.packing_uom = i.based_uom
 WHERE s.tenant_id = '528521' AND s.is_deleted = 0 AND l.is_deleted = 0 AND i.is_deleted = 0
   AND s.so_status IN ('Issued', 'Processing', 'In Progress', 'Partially Delivered')
   AND IFNULL(l.line_status, '') NOT IN ('Completed', 'Cancelled')
   AND l.so_quantity > IFNULL(l.delivered_qty, 0) + IFNULL(l.planned_qty, 0)
   AND l.so_item_uom <> i.based_uom
   AND LOWER(TRIM(su.uom_name)) = LOWER(TRIM(bu.uom_name)) COLLATE utf8mb4_bin
   AND l.packing_uom = l.so_item_uom;

-- 2. the line's unit
UPDATE sales_order_axszx8cj_sub l
  JOIN sales_order s ON s.id = l.sales_order_id
  JOIN item i ON i.id = l.item_name AND i.tenant_id = s.tenant_id
  JOIN unit_of_measurement su ON su.id = l.so_item_uom
  JOIN unit_of_measurement bu ON bu.id = i.based_uom
   SET l.so_item_uom = i.based_uom
 WHERE s.tenant_id = '528521' AND s.is_deleted = 0 AND l.is_deleted = 0 AND i.is_deleted = 0
   AND s.so_status IN ('Issued', 'Processing', 'In Progress', 'Partially Delivered')
   AND IFNULL(l.line_status, '') NOT IN ('Completed', 'Cancelled')
   AND l.so_quantity > IFNULL(l.delivered_qty, 0) + IFNULL(l.planned_qty, 0)
   AND l.so_item_uom <> i.based_uom
   AND LOWER(TRIM(su.uom_name)) = LOWER(TRIM(bu.uom_name)) COLLATE utf8mb4_bin;

COMMIT;

-- 3. check: the preview above now returns no rows.
--    On 10-23 16:10 the two UPDATEs reported 4 and 307 rows (more if Kenhin has switched another base unit since).
