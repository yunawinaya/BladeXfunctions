SELECT e.*,
       (e.src > 0 AND e.loc > 0 AND e.loc <> e.src) OR (e.bat0 > 0 AND e.bat > 0 AND e.bat <> e.bat0) AS moved,
       (e.loc IS NULL OR e.loc = 0 OR e.loc = e.src) AS bay_bad
  FROM (SELECT l.id, l.gd_id, l.handling_unit_id,
               COALESCE(NULLIF(l.item_name, ''), CAST(l.item_code AS CHAR)) AS label,
               COALESCE(l.source_bin, 0) AS src,
               COALESCE(l.batch_no, 0) AS bat0,
               COALESCE(CASE WHEN p.r IS NOT NULL AND p.pl IS NOT NULL THEN NULLIF(p.pl, 0) ELSE NULLIF(l.target_location, 0) END, l.source_bin) AS loc,
               COALESCE(CASE WHEN p.r IS NOT NULL AND p.pb IS NOT NULL THEN NULLIF(p.pb, 0) ELSE NULLIF(l.target_batch, 0) END, l.batch_no) AS bat
          FROM transfer_order_jz8m9w3h_sub l
          LEFT JOIN JSON_TABLE('{{node:code_node_PSguard.data.moveRowsJson}}', '$[*]' COLUMNS (r BIGINT PATH '$.r', pl BIGINT PATH '$.l', pb BIGINT PATH '$.b')) p
            ON p.r = l.id
         WHERE l.tenant_id = '{{node:code_node_PSguard.data.tenantId}}'
           AND l.transfer_order_id = {{node:code_node_PSguard.data.pickingId}}
           AND l.is_deleted = 0
           AND COALESCE(l.line_status, '') <> 'Cancelled'
           AND (('{{node:code_node_PSguard.data.operation}}' = 'PICK_ALL_REMAINING' AND l.pending_process_qty > 0) OR p.r IS NOT NULL)) e
