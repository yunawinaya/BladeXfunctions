SELECT CAST(g.id AS CHAR) AS id, g.gr_no, g.gr_status
  FROM goods_receiving g
 WHERE g.tenant_id = '{{system:tenantId}}'
   AND SUBSTRING_INDEX(g.gr_idem_key, '#', 1) = '{{node:code_node_GcPrep.data.keySql}}'
   AND g.is_deleted = 0
 ORDER BY g.id
 LIMIT 1
