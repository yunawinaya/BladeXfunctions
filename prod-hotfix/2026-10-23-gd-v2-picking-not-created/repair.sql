-- Prod repair 2026-10-23: Goods Deliveries saved as Created through V2 since the 10-22 cut, in organizations whose Picking
-- Setup (first row, as the save reads it) is picking_after = 'Goods Delivery', picking_required = 1, auto_trigger_to not 1,
-- were left with a blank picking_status, so Convert to Picking refuses them. Stamp "Not Created" as the classic save does.
-- Only Created GDs, not from a Picking, with no Picking rows yet. Run AFTER the GD_BULK_PREPARE paste (else new ones keep
-- coming). Order matters: lines first (they join on the header's blank status), then the header.

-- 1. preview (expect GD/20261023/100 in 496474, plus any saved before the paste)
SELECT g.tenant_id, g.delivery_no, CAST(g.id AS CHAR) AS gd_id, g.create_time,
       (SELECT COUNT(*) FROM goods_delivery_fwii8mvb_sub l WHERE l.goods_delivery_id = g.id AND l.is_deleted = 0
           AND (l.picking_status IS NULL OR l.picking_status = '') AND l.material_id IS NOT NULL AND l.material_id <> '') AS blank_lines
  FROM goods_delivery g
 WHERE g.id > 2112936949969846272 AND g.is_deleted = 0 AND g.gd_status = 'Created'
   AND (g.picking_status IS NULL OR g.picking_status = '') AND IFNULL(g.is_select_picking, 0) <> 1
   AND (SELECT CONCAT(ps.picking_after, '|', ps.picking_required, '|', IFNULL(ps.auto_trigger_to, 0)) FROM picking_setup ps
         WHERE ps.tenant_id = g.tenant_id AND ps.organization_id = g.organization_id AND ps.is_deleted = 0 ORDER BY ps.id LIMIT 1) = 'Goods Delivery|1|0'
   AND NOT EXISTS (SELECT 1 FROM transfer_order_jz8m9w3h_sub i WHERE i.tenant_id = g.tenant_id AND i.gd_id = g.id AND i.is_deleted = 0);

-- 2. lines
UPDATE goods_delivery_fwii8mvb_sub l
  JOIN goods_delivery g ON g.id = l.goods_delivery_id AND g.tenant_id = l.tenant_id
   SET l.picking_status = 'Not Created'
 WHERE g.id > 2112936949969846272 AND g.is_deleted = 0 AND g.gd_status = 'Created'
   AND (g.picking_status IS NULL OR g.picking_status = '') AND IFNULL(g.is_select_picking, 0) <> 1
   AND (SELECT CONCAT(ps.picking_after, '|', ps.picking_required, '|', IFNULL(ps.auto_trigger_to, 0)) FROM picking_setup ps
         WHERE ps.tenant_id = g.tenant_id AND ps.organization_id = g.organization_id AND ps.is_deleted = 0 ORDER BY ps.id LIMIT 1) = 'Goods Delivery|1|0'
   AND NOT EXISTS (SELECT 1 FROM transfer_order_jz8m9w3h_sub i WHERE i.tenant_id = g.tenant_id AND i.gd_id = g.id AND i.is_deleted = 0)
   AND l.is_deleted = 0 AND (l.picking_status IS NULL OR l.picking_status = '') AND l.material_id IS NOT NULL AND l.material_id <> '';

-- 3. headers
UPDATE goods_delivery g
   SET g.picking_status = 'Not Created'
 WHERE g.id > 2112936949969846272 AND g.is_deleted = 0 AND g.gd_status = 'Created'
   AND (g.picking_status IS NULL OR g.picking_status = '') AND IFNULL(g.is_select_picking, 0) <> 1
   AND (SELECT CONCAT(ps.picking_after, '|', ps.picking_required, '|', IFNULL(ps.auto_trigger_to, 0)) FROM picking_setup ps
         WHERE ps.tenant_id = g.tenant_id AND ps.organization_id = g.organization_id AND ps.is_deleted = 0 ORDER BY ps.id LIMIT 1) = 'Goods Delivery|1|0'
   AND NOT EXISTS (SELECT 1 FROM transfer_order_jz8m9w3h_sub i WHERE i.tenant_id = g.tenant_id AND i.gd_id = g.id AND i.is_deleted = 0);
