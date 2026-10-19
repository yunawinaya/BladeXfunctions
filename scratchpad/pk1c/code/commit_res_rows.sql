SELECT CAST('U' AS CHAR) AS k,
       CAST(JSON_OBJECT('id', CAST(r.id AS CHAR), 'target_gd_id', r.target_gd_id, 'status', r.status, 'reserved_qty', r.reserved_qty, 'open_qty', r.open_qty,
                        'delivered_qty', r.delivered_qty, 'doc_no', r.doc_no, 'doc_id', r.doc_id, 'doc_line_id', r.doc_line_id, 'source_reserved_id', r.source_reserved_id,
                        'item_uom', CAST(r.item_uom AS CHAR), 'is_deleted', r.is_deleted) AS CHAR) AS j
  FROM on_reserved_gd r
 WHERE r.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND r.id IN (SELECT jt.i FROM JSON_TABLE('{{node:code_node_PCmvparse.data.resIdsJson}}', '$[*]' COLUMNS (i BIGINT PATH '$')) jt)
