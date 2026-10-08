-- R7  BUG-001  GD-20261001-294 line still overwritten by the stale zone-Picking save (LSH 128671)
-- ---------------------------------------------------------------------------------------------
-- GD-20260930-280 was already restored (line Completed/2 since 2026-10-02 12:18). GD-294's line
-- 2105475451119079426 (item 1067-002) still reads Created / 0 although Picking PI-20261001-0533
-- confirmed 5. Restores exactly the four picking fields PI-0533 wrote (from its recorded
-- GOODS_DELIVERY payload, run 2105479503777239041); every other field already matches.
-- Then the header rolls up: this was the last unpicked line (42 of 43 before).
-- Does NOT post stock, create a Picking or mark anything packed. PACK-20261001-0172 already
-- carries the line (5 to pack), so Packing can proceed once the line reads Completed.
-- Run in Bytebase on PROD with backup ON.
-- ---------------------------------------------------------------------------------------------

-- BEFORE (expect: picking_status Created, picked_qty 0, picked_temp_qty_data NULL, gd_qty 5)
SELECT l.id, g.delivery_no, g.picking_status AS header, l.picking_status, l.picked_qty,
       l.picked_temp_qty_data, l.picked_view_stock, l.gd_qty
FROM goods_delivery_fwii8mvb_sub l
JOIN goods_delivery g ON g.id = l.goods_delivery_id
WHERE l.id = 2105475451119079426 AND l.is_deleted = 0;

-- FIX 1: the line (expect 1 row affected)
UPDATE goods_delivery_fwii8mvb_sub
SET picking_status = 'Completed',
    picked_qty = 5,
    picked_temp_qty_data = '[{"material_id":"2092498442302660613","location_id":"2079488854498349057","batch_id":"2102794843175653377","handling_unit_id":null,"gd_quantity":5,"plant_id":"1996821057533001730","organization_id":"1996787068457861121"}]',
    picked_view_stock = 'Total: 5 PCS\n\nDETAILS:\n1. Lot 5-A: 5 PCS\n[Batch: 1067-002-0001]'
WHERE id = 2105475451119079426
  AND tenant_id = '128671'
  AND is_deleted = 0
  AND picking_status = 'Created'
  AND picked_qty = 0
  AND gd_qty = 5;

-- FIX 2: the header, only if no pickable line is left (expect 1 row affected)
UPDATE goods_delivery g
SET g.picking_status = 'Completed'
WHERE g.id = 2105475450909364226
  AND g.tenant_id = '128671' AND g.is_deleted = 0
  AND g.gd_status = 'Created' AND g.picking_status IN ('Created', 'In Progress')
  AND NOT EXISTS (SELECT 1 FROM goods_delivery_fwii8mvb_sub l
                  WHERE l.goods_delivery_id = g.id AND l.is_deleted = 0
                    AND l.material_id <> '' AND l.gd_qty > 0
                    AND COALESCE(l.picking_status, '') NOT IN ('Completed', 'Cancelled'));

-- AFTER: re-run BEFORE (line Completed / 5, header Completed).
