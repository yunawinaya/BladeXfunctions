SELECT 'SOL' AS kind, CAST(l.id AS CHAR) AS id, CAST(l.sales_order_id AS CHAR) AS k, CAST(l.line_status AS CHAR) AS v, CAST(l.planned_qty AS CHAR) AS n, CAST(l.delivered_qty AS CHAR) AS x, CAST(l.outstanding_quantity AS CHAR) AS y, CAST(l.is_deleted AS CHAR) AS deleted
  FROM sales_order_axszx8cj_sub l
 WHERE l.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND l.id IN ({{node:code_node_rZGbQJid.data.soLineIdsSql}})
UNION ALL
SELECT 'SOH' AS kind, CAST(so.id AS CHAR) AS id, CAST(so.so_status AS CHAR) AS k, CAST(so.gd_status AS CHAR) AS v, CAST(so.partially_delivered AS CHAR) AS n, CAST(so.fully_delivered AS CHAR) AS x, '' AS y, CAST(so.is_deleted AS CHAR) AS deleted
  FROM sales_order so
 WHERE so.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND so.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND so.id IN ({{node:code_node_rZGbQJid.data.soIdsSql}})
UNION ALL
SELECT 'HID' AS kind, CAST(h.so_line_item_id AS CHAR) AS id, '' AS k, '' AS v, CAST(SUM(h.gd_qty) AS CHAR) AS n, '' AS x, '' AS y, '0' AS deleted
  FROM goods_delivery_fwii8mvb_sub h
  JOIN goods_delivery g
    ON g.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND g.id = h.goods_delivery_id
   AND g.gd_status = 'Processing'
   AND g.is_deleted = 0
 WHERE h.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND h.is_deleted = 0
   AND h.so_line_item_id IN ({{node:code_node_rZGbQJid.data.soLineIdsSql}})
   AND COALESCE(h.job_line_key, '') NOT LIKE '{{node:code_node_WaEyJtlE.data.jobPrefixLike}}'
 GROUP BY h.so_line_item_id
UNION ALL
SELECT 'STEP' AS kind, CAST(st.id AS CHAR) AS id, CAST(st.step_name AS CHAR) AS k, CAST(st.step_status AS CHAR) AS v, CAST(st.attempt_count AS CHAR) AS n, CAST(st.inventory_operation_id AS CHAR) AS x, CAST(st.result_ref AS CHAR) AS y, CAST(st.is_deleted AS CHAR) AS deleted
  FROM gd_publish_step st
 WHERE st.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND st.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND st.is_deleted = 0