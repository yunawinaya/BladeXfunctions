SELECT 'JOB' AS kind, CAST(j.id AS CHAR) AS id, CAST(j.error_code AS CHAR) AS k, CAST(j.job_status AS CHAR) AS v, CAST(j.row_version AS CHAR) AS n, CAST(j.gd_id AS CHAR) AS x, CAST(j.lease_owner AS CHAR) AS y, CAST(j.is_deleted AS CHAR) AS deleted
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND j.id = {{node:code_node_WaEyJtlE.data.jobId}}
UNION ALL
SELECT 'GD' AS kind, CAST(g.id AS CHAR) AS id, CAST(g.delivery_no AS CHAR) AS k, CAST(g.gd_status AS CHAR) AS v, '' AS n, '' AS x, '' AS y, CAST(g.is_deleted AS CHAR) AS deleted
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND g.gd_dockey = CONCAT('JOB|', '{{node:code_node_WaEyJtlE.data.jobId}}')
   AND g.is_deleted = 0
UNION ALL
SELECT 'OP' AS kind, CAST(o.id AS CHAR) AS id, CAST(o.operation_id AS CHAR) AS k, CAST(o.operation_status AS CHAR) AS v, '' AS n, CAST(o.result_code AS CHAR) AS x, CAST(o.review_reference AS CHAR) AS y, CAST(o.is_deleted AS CHAR) AS deleted
  FROM inventory_operation o
 WHERE o.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND o.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND o.operation_id = '{{node:code_node_rZGbQJid.data.operationId}}'
   AND o.is_deleted = 0