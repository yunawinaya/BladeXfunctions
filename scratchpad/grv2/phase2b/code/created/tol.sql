SELECT CAST(u.Item_id AS CHAR) AS item_id, CAST(u.alt_uom_id AS CHAR) AS uom_id,
       u.over_receive_tolerance AS tol
  FROM JSON_TABLE(CONCAT('[', '{{node:code_node_GcPrep.data.itemCsv}}', ']'),
                  '$[*]' COLUMNS (iid BIGINT PATH '$')) sel
  JOIN item i ON i.id = sel.iid AND i.is_deleted = 0
  JOIN item_mji552rc_sub u ON u.Item_id = i.id AND u.tenant_id = i.tenant_id AND u.is_deleted = 0
 WHERE i.tenant_id = '{{system:tenantId}}'
 ORDER BY u.Item_id, u.id
