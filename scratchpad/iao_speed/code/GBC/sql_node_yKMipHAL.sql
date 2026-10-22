SELECT 'GD' AS kind, CAST(g.id AS CHAR) AS id, CAST(g.delivery_no AS CHAR) AS k, CAST(g.gd_status AS CHAR) AS v, '' AS n, CAST(g.organization_id AS CHAR) AS x, CAST(g.gd_dockey AS CHAR) AS y, CAST(g.is_deleted AS CHAR) AS deleted
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND g.gd_dockey = CONCAT('JOB|', '{{node:code_node_WaEyJtlE.data.jobId}}')
UNION ALL
SELECT 'LINES' AS kind, '' AS id, '' AS k, '' AS v, CAST(COUNT(*) AS CHAR) AS n, '' AS x, '' AS y, '0' AS deleted
  FROM goods_delivery_fwii8mvb_sub l
 WHERE l.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND l.is_deleted = 0
   AND l.job_line_key LIKE '{{node:code_node_WaEyJtlE.data.jobPrefixLike}}'
UNION ALL
SELECT 'RES' AS kind, '' AS id, '' AS k, '' AS v, CAST(COUNT(*) AS CHAR) AS n, '' AS x, '' AS y, '0' AS deleted
  FROM on_reserved_gd r
 WHERE r.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND r.is_deleted = 0
   AND r.job_line_key LIKE '{{node:code_node_WaEyJtlE.data.jobPrefixLike}}'
UNION ALL
SELECT 'OUTBOX' AS kind, CAST(o.id AS CHAR) AS id, CAST(o.event_id AS CHAR) AS k, CAST(o.dispatch_status AS CHAR) AS v, CAST(o.row_version AS CHAR) AS n, CAST(o.payload_hash AS CHAR) AS x, CAST(o.aggregate_id AS CHAR) AS y, CAST(o.is_deleted AS CHAR) AS deleted
  FROM gd_outbox o
 WHERE o.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND o.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND o.is_deleted = 0