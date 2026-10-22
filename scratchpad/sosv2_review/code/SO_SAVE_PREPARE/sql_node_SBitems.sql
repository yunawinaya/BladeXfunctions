SELECT CAST(i.id AS CHAR) AS id,
       i.material_code,
       i.material_name,
       CAST(i.based_uom AS CHAR) AS based_uom,
       i.material_costing_method,
       COALESCE((
           SELECT JSON_ARRAYAGG(JSON_OBJECT(
                      'alt_uom_id', CAST(u.alt_uom_id AS CHAR),
                      'base_qty', u.base_qty))
           FROM item_mji552rc_sub u
           WHERE u.Item_id = i.id
             AND u.is_deleted = 0
       ), '[]') AS uom_conversion_json
FROM JSON_TABLE(CONCAT('[', '{{node:code_node_SBdiff.data.materialIdCsv}}', ']'),
                '$[*]' COLUMNS (mid BIGINT PATH '$')) sel
JOIN item i
  ON i.id = sel.mid
 AND i.is_deleted = 0
 AND (i.organization_id = '{{node:code_node_SBdiff.data.orgIdSafe}}'
      OR '{{node:code_node_SBdiff.data.orgIdSafe}}' = '')