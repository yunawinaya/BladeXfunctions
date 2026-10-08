-- R2  BUG-005  GD headers left Created / In Progress although every line is picked
-- ---------------------------------------------------------------------------------------------
-- OPTIONAL. After GOODS_DELIVERY is deployed these GDs complete normally (the completion gate now
-- rolls the header up from the lines), so this only corrects what the list shows until then.
-- Run in Bytebase on PROD with backup ON. Header-only; lines, stock and Packing are untouched.
-- ---------------------------------------------------------------------------------------------

-- BEFORE (expect 8 rows; must_pick = picked on every row)
SELECT g.tenant_id, g.id, g.delivery_no, g.gd_status, g.picking_status, g.packing_status,
       SUM(l.material_id <> '' AND l.gd_qty > 0 AND COALESCE(l.picking_status, '') <> 'Cancelled') AS must_pick,
       SUM(l.material_id <> '' AND l.gd_qty > 0 AND l.picking_status = 'Completed') AS picked
FROM goods_delivery g
JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0
WHERE g.is_deleted = 0 AND g.id IN (
  2105827398292475905, 2105838183232180225, 2105840789459439618, 2105855284160368641,
  2105856654921830401, 2105859946829713409, 2105865179370754049, 2105525938635804674)
GROUP BY g.tenant_id, g.id, g.delivery_no, g.gd_status, g.picking_status, g.packing_status;

-- FIX (expect 8 rows affected; fewer means a GD changed since -- re-run BEFORE)
UPDATE goods_delivery g
SET g.picking_status = 'Completed'
WHERE g.tenant_id IN ('128671', '528521')
  AND g.is_deleted = 0
  AND g.gd_status = 'Created'
  AND g.picking_status IN ('Created', 'In Progress')
  AND g.id IN (
    2105827398292475905,  -- GD-20261002-328
    2105838183232180225,  -- GD-20261002-335
    2105840789459439618,  -- GD-20261002-337
    2105855284160368641,  -- GD-20261002-341
    2105856654921830401,  -- GD-20261002-342
    2105859946829713409,  -- GD-20261002-343
    2105865179370754049,  -- GD-20261002-344
    2105525938635804674)  -- GD/20261001/1275 (Kenhin)
  AND EXISTS (SELECT 1 FROM goods_delivery_fwii8mvb_sub l
              WHERE l.goods_delivery_id = g.id AND l.is_deleted = 0
                AND l.material_id <> '' AND l.gd_qty > 0)
  AND NOT EXISTS (SELECT 1 FROM goods_delivery_fwii8mvb_sub l
                  WHERE l.goods_delivery_id = g.id AND l.is_deleted = 0
                    AND l.material_id <> '' AND l.gd_qty > 0
                    AND COALESCE(l.picking_status, '') NOT IN ('Completed', 'Cancelled'));

-- AFTER (expect 8 rows, picking_status Completed): re-run BEFORE.
