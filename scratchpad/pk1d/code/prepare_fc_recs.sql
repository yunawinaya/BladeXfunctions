SELECT CAST(r.id AS CHAR) AS id, CAST(r.transfer_order_id AS CHAR) AS transfer_order_id, t.to_status, CAST(r.gd_line_id AS CHAR) AS gd_line_id, r.job_line_key,
       CAST(r.source_bin AS CHAR) AS source_bin, CAST(r.target_location AS CHAR) AS target_location, CAST(r.batch_no AS CHAR) AS batch_no,
       CAST(r.target_batch AS CHAR) AS target_batch, CAST(r.handling_unit_id AS CHAR) AS handling_unit_id, r.store_out_qty, CAST(r.item_code AS CHAR) AS item_code,
       CAST(COALESCE(NULLIF(b1.bin_location_combine, ''), b1.bin_name) AS CHAR) AS source_bin_name,
       CAST(COALESCE(NULLIF(b2.bin_location_combine, ''), b2.bin_name) AS CHAR) AS target_location_name,
       CAST(bt1.batch_number AS CHAR) AS batch_name, CAST(bt2.batch_number AS CHAR) AS target_batch_name, CAST(h.handling_no AS CHAR) AS hu_name
  FROM transfer_order t
  JOIN transfer_order_vrqs3cmr_sub r ON r.transfer_order_id = t.id AND r.tenant_id = t.tenant_id AND r.is_deleted = 0
  LEFT JOIN bin_location b1 ON b1.id = CAST(NULLIF(r.source_bin, '') AS UNSIGNED)
  LEFT JOIN bin_location b2 ON b2.id = CAST(NULLIF(r.target_location, '') AS UNSIGNED)
  LEFT JOIN batch bt1 ON bt1.id = CAST(NULLIF(r.batch_no, '') AS UNSIGNED)
  LEFT JOIN batch bt2 ON bt2.id = CAST(NULLIF(r.target_batch, '') AS UNSIGNED)
  LEFT JOIN handling_unit h ON h.id = CAST(NULLIF(r.handling_unit_id, '') AS UNSIGNED)
 WHERE t.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND t.is_deleted = 0
   AND (SELECT COUNT(*) FROM JSON_TABLE(IF(JSON_VALID(t.gd_no), t.gd_no, '[]'), '$[*]' COLUMNS (gid VARCHAR(32) PATH '$')) jt
                WHERE CAST(jt.gid AS UNSIGNED) IN (SELECT CAST(i.gd_id AS UNSIGNED) FROM transfer_order_jz8m9w3h_sub i
                                  WHERE i.transfer_order_id = {{node:code_node_PPentry.data.pickingId}} AND i.tenant_id = '{{node:code_node_PPentry.data.tenantId}}' AND i.is_deleted = 0 AND COALESCE(i.gd_id, '') <> '')) > 0
 ORDER BY r.id
