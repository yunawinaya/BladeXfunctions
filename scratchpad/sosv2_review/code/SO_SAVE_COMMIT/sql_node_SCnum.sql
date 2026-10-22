SELECT s.so_no,
       CAST(s.so_no_type AS CHAR) AS so_no_type
  FROM sales_order s
 WHERE s.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND s.is_deleted = 0
   AND s.id = {{node:code_node_SCa2.data.soId}}