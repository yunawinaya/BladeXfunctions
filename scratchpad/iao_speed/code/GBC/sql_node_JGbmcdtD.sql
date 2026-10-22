SELECT 'OUTBOX' AS kind, CAST(ob.id AS CHAR) AS id, CAST(ob.job_id AS CHAR) AS k, CAST(ob.dispatch_status AS CHAR) AS v, CAST(ob.row_version AS CHAR) AS n, CAST(ob.payload_hash AS CHAR) AS x, CAST(ob.event_id AS CHAR) AS y, CAST(ob.is_deleted AS CHAR) AS deleted
  FROM gd_outbox ob
 WHERE ob.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND ob.event_id = '{{node:code_node_3n1ATbZu.data.eventId}}'
   AND ob.is_deleted = 0
UNION ALL
SELECT 'GD' AS kind, CAST(g.id AS CHAR) AS id, CAST(g.delivery_no AS CHAR) AS k, CAST(g.gd_status AS CHAR) AS v, '' AS n, '' AS x, '' AS y, CAST(g.is_deleted AS CHAR) AS deleted
  FROM goods_delivery g
 WHERE g.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND g.id = {{node:code_node_3n1ATbZu.data.gdId}}
   AND g.is_deleted = 0
UNION ALL
SELECT 'RESID' AS kind, CAST(r.id AS CHAR) AS id, CAST(r.job_line_key AS CHAR) AS k, CAST(r.status AS CHAR) AS v, '' AS n, CAST(r.target_gd_id AS CHAR) AS x, '' AS y, CAST(r.is_deleted AS CHAR) AS deleted
  FROM on_reserved_gd r
 WHERE r.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND r.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND r.is_deleted = 0
   AND r.job_line_key LIKE '{{node:code_node_WaEyJtlE.data.jobPrefixLike}}'
UNION ALL
SELECT 'PACK' AS kind, CAST(pk.id AS CHAR) AS id, CAST(pk.idempotency_key AS CHAR) AS k, CAST(pk.packing_status AS CHAR) AS v, CAST(pk.packing_no AS CHAR) AS n, CAST(pk.gd_id AS CHAR) AS x, '' AS y, CAST(pk.is_deleted AS CHAR) AS deleted
  FROM packing pk
 WHERE pk.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND pk.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND pk.is_deleted = 0
   AND pk.idempotency_key = CONCAT('PKG|', '{{node:code_node_3n1ATbZu.data.gdId}}')
UNION ALL
SELECT 'STEP' AS kind, CAST(st.id AS CHAR) AS id, CAST(st.step_name AS CHAR) AS k, CAST(st.step_status AS CHAR) AS v, CAST(st.attempt_count AS CHAR) AS n, CAST(st.inventory_operation_id AS CHAR) AS x, CAST(st.result_ref AS CHAR) AS y, CAST(st.is_deleted AS CHAR) AS deleted
  FROM gd_publish_step st
 WHERE st.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND st.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND st.is_deleted = 0