SELECT CAST(r.transfer_order_id AS CHAR) AS sibling_id,
       CAST(r.gd_line_id AS CHAR) AS gd_line_id,
       r.store_out_qty,
       CAST(r.source_bin AS CHAR) AS source_bin,
       CAST(r.target_location AS CHAR) AS target_location,
       CAST(r.batch_no AS CHAR) AS batch_no,
       CAST(r.target_batch AS CHAR) AS target_batch,
       CAST(r.handling_unit_id AS CHAR) AS handling_unit_id
FROM transfer_order t
JOIN transfer_order_vrqs3cmr_sub r
  ON r.transfer_order_id = t.id AND r.tenant_id = t.tenant_id AND r.is_deleted = 0
JOIN JSON_TABLE(CONCAT('[', '{{node:code_node_SibPrep.data.lineIdCsv}}', ']'),
                '$[*]' COLUMNS (lid BIGINT PATH '$')) l ON l.lid = r.gd_line_id
WHERE t.organization_id = '{{node:code_node_SibPrep.data.orgId}}'
  AND t.is_deleted = 0
  AND t.id <> {{node:code_node_SibPrep.data.ownId}}
  AND (JSON_OVERLAPS(t.gd_no, CAST(CONCAT('[', '{{node:code_node_SibPrep.data.gdIdCsv}}', ']') AS JSON))
       OR JSON_OVERLAPS(t.gd_no, (SELECT JSON_ARRAYAGG(CAST(d.id AS CHAR))
                                    FROM JSON_TABLE(CONCAT('[', '{{node:code_node_SibPrep.data.gdIdCsv}}', ']'),
                                                    '$[*]' COLUMNS (id BIGINT PATH '$')) d)))