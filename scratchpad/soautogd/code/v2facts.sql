SELECT 'HU' AS kind, CAST(hi.material_id AS CHAR) AS id
  FROM handling_unit h
  JOIN handling_unit_atu7sreg_sub hi
    ON hi.handling_unit_id = h.id
   AND hi.is_deleted = 0
 WHERE h.organization_id = '{{node:code_v2ids.data.orgSql}}'
   AND h.plant_id = {{node:code_v2ids.data.plantSql}}
   AND h.is_deleted = 0
   AND (h.packing_id IS NULL OR h.packing_id = '')
   AND hi.material_id IN ({{node:code_gate.data.materialIdCsv}})
 GROUP BY hi.material_id
UNION ALL
SELECT 'PEND' AS kind, CAST(r.parent_line_id AS CHAR) AS id
  FROM on_reserved_gd r
 WHERE r.organization_id = '{{node:code_v2ids.data.orgSql}}'
   AND r.plant_id = {{node:code_v2ids.data.plantSql}}
   AND r.is_deleted = 0
   AND r.status = 'Pending'
   AND r.parent_line_id IN ({{node:code_v2ids.data.soLineIdsSql}})
 GROUP BY r.parent_line_id
