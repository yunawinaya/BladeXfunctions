SELECT CAST(r.id AS CHAR) AS id,
       r.organization_id AS organization_id,
       CAST(r.plant_id AS CHAR) AS plant_id,
       r.doc_type AS doc_type,
       r.status AS status,
       r.target_gd_id AS target_gd_id,
       CAST(r.material_id AS CHAR) AS material_id,
       CAST(r.bin_location AS CHAR) AS bin_location,
       CAST(r.batch_id AS CHAR) AS batch_id,
       CAST(r.item_uom AS CHAR) AS item_uom,
       CAST(r.reserved_qty AS CHAR) AS reserved_qty,
       CAST(r.delivered_qty AS CHAR) AS delivered_qty,
       CAST(r.open_qty AS CHAR) AS open_qty,
       r.handling_unit_id AS handling_unit_id,
       CAST(r.is_deleted AS CHAR) AS is_deleted,
       (SELECT COUNT(*) FROM item_mji552rc_sub c
         WHERE c.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}' AND c.is_deleted = 0
           AND c.Item_id = r.material_id AND c.alt_uom_id = r.item_uom) AS conv_count,
       (SELECT CAST(c.base_qty AS CHAR) FROM item_mji552rc_sub c
         WHERE c.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}' AND c.is_deleted = 0
           AND c.Item_id = r.material_id AND c.alt_uom_id = r.item_uom ORDER BY c.id LIMIT 1) AS conv_base_qty,
       (SELECT CAST(c.alt_qty AS CHAR) FROM item_mji552rc_sub c
         WHERE c.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}' AND c.is_deleted = 0
           AND c.Item_id = r.material_id AND c.alt_uom_id = r.item_uom ORDER BY c.id LIMIT 1) AS conv_alt_qty
  FROM on_reserved_gd r
 WHERE r.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND r.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND r.id IN ({{node:code_node_cW0Exw93.data.reservationIdsSql}})