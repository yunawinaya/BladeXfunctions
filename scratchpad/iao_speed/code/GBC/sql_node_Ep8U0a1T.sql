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
SELECT 'STEP' AS kind, CAST(st.id AS CHAR) AS id, CAST(st.step_name AS CHAR) AS k, CAST(st.step_status AS CHAR) AS v, CAST(st.attempt_count AS CHAR) AS n, CAST(st.inventory_operation_id AS CHAR) AS x, CAST(st.result_ref AS CHAR) AS y, CAST(st.is_deleted AS CHAR) AS deleted
  FROM gd_publish_step st
 WHERE st.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND st.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND st.is_deleted = 0