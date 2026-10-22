SELECT 'GD' AS kind, CAST(g.id AS CHAR) AS id, CAST(g.delivery_no AS CHAR) AS k, CAST(g.gd_status AS CHAR) AS v, '' AS n, CAST(g.organization_id AS CHAR) AS x, CAST(g.gd_dockey AS CHAR) AS y, CAST(g.is_deleted AS CHAR) AS deleted
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND (g.gd_dockey = CONCAT('JOB|', '{{node:code_node_WaEyJtlE.data.jobId}}')
        OR (g.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}' AND g.delivery_no = '{{node:code_node_rZGbQJid.data.deliveryNo}}'))
UNION ALL
SELECT 'STEP' AS kind, CAST(st.id AS CHAR) AS id, CAST(st.step_name AS CHAR) AS k, CAST(st.step_status AS CHAR) AS v, CAST(st.attempt_count AS CHAR) AS n, CAST(st.inventory_operation_id AS CHAR) AS x, CAST(st.result_ref AS CHAR) AS y, CAST(st.is_deleted AS CHAR) AS deleted
  FROM gd_publish_step st
 WHERE st.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND st.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND st.is_deleted = 0