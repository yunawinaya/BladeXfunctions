SELECT CAST(i.id AS CHAR) AS id,
       i.material_code,
       i.item_batch_management,
       i.stock_control,
       COALESCE((
           SELECT JSON_ARRAYAGG(JSON_OBJECT(
                      'alt_uom_id', CAST(u.alt_uom_id AS CHAR),
                      'base_qty', u.base_qty))
           FROM item_mji552rc_sub u
           WHERE u.Item_id = i.id
             AND u.is_deleted = 0
       ), '[]') AS uom_conversion_json,
       COALESCE((
           SELECT JSON_ARRAYAGG(JSON_OBJECT(
                      'plant_id', CAST(b.plant_id AS CHAR),
                      'bin_location', CAST(b.bin_location AS CHAR)))
           FROM item_wu520fpw_sub b
           WHERE b.Item_id = i.id
             AND b.is_deleted = 0
       ), '[]') AS default_bin_json
FROM JSON_TABLE(CONCAT('[', '{{node:code_node_SAids.data.materialIdCsv}}', ']'),
                '$[*]' COLUMNS (mid BIGINT PATH '$')) sel
JOIN item i
  ON i.id = sel.mid
 AND i.is_deleted = 0