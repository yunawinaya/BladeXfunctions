SELECT 'OP' AS kind, CAST(o.id AS CHAR) AS id, CAST(o.operation_id AS CHAR) AS k, CAST(o.operation_status AS CHAR) AS v, '' AS n, CAST(o.result_code AS CHAR) AS x, CAST(o.review_reference AS CHAR) AS y, CAST(o.is_deleted AS CHAR) AS deleted
  FROM inventory_operation o
 WHERE o.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND o.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND o.operation_id = '{{node:code_node_rZGbQJid.data.operationId}}'
   AND o.is_deleted = 0
UNION ALL
SELECT 'EFF' AS kind, CAST(e.id AS CHAR) AS id, CAST(e.effect_key AS CHAR) AS k, CAST(e.effect_status AS CHAR) AS v, CAST(e.quantity_base AS CHAR) AS n, CAST(e.balance_key AS CHAR) AS x, CAST(e.direction AS CHAR) AS y, CAST(e.is_deleted AS CHAR) AS deleted
  FROM inventory_operation_effect e
 WHERE e.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND e.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND e.operation_id = '{{node:code_node_rZGbQJid.data.operationId}}'
   AND e.is_deleted = 0
UNION ALL
SELECT 'GD' AS kind, CAST(g.id AS CHAR) AS id, CAST(g.delivery_no AS CHAR) AS k, CAST(g.gd_status AS CHAR) AS v, '' AS n, '' AS x, '' AS y, CAST(g.is_deleted AS CHAR) AS deleted
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND g.id = {{node:code_node_3n1ATbZu.data.gdId}}
   AND g.is_deleted = 0
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
SELECT 'PACK' AS kind, '' AS id, '' AS k, '' AS v, CAST(COUNT(*) AS CHAR) AS n, '' AS x, '' AS y, '0' AS deleted
  FROM packing pk
 WHERE pk.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND pk.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND pk.is_deleted = 0
   AND pk.idempotency_key = CONCAT('PKG|', '{{node:code_node_3n1ATbZu.data.gdId}}')
UNION ALL
SELECT 'OUTBOX' AS kind, CAST(ob.id AS CHAR) AS id, CAST(ob.event_id AS CHAR) AS k, CAST(ob.dispatch_status AS CHAR) AS v, CAST(ob.row_version AS CHAR) AS n, CAST(ob.payload_hash AS CHAR) AS x, CAST(ob.aggregate_id AS CHAR) AS y, CAST(ob.is_deleted AS CHAR) AS deleted
  FROM gd_outbox ob
 WHERE ob.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND ob.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND ob.is_deleted = 0
UNION ALL
SELECT 'STEP' AS kind, CAST(st.id AS CHAR) AS id, CAST(st.step_name AS CHAR) AS k, CAST(st.step_status AS CHAR) AS v, CAST(st.attempt_count AS CHAR) AS n, CAST(st.inventory_operation_id AS CHAR) AS x, CAST(st.result_ref AS CHAR) AS y, CAST(st.is_deleted AS CHAR) AS deleted
  FROM gd_publish_step st
 WHERE st.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND st.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND st.is_deleted = 0