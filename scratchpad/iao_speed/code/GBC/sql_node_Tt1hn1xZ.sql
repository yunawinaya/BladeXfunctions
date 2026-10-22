SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(o.id AS CHAR) AS id,
       o.operation_id,
       o.operation_status,
       o.result_code,
       o.review_reference,
       DATE_FORMAT(o.mutation_started_at, '%Y-%m-%d %H:%i:%s.%f') AS mutation_started_at,
       DATE_FORMAT(o.lease_expires_at, '%Y-%m-%d %H:%i:%s.%f') AS lease_expires_at,
       (o.lease_expires_at > n.t) AS lease_live,
       (g.id IS NOT NULL) AS gate_taken,
       g.owner_operation_id AS gate_owner,
       CAST(st.id AS CHAR) AS p3_id,
       st.step_status AS p3_status,
       st.attempt_count AS p3_attempt,
       st.inventory_operation_id AS p3_op
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN inventory_operation o
    ON o.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND o.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND o.operation_id = '{{node:code_node_rZGbQJid.data.operationId}}'
   AND o.is_deleted = 0
  LEFT JOIN inventory_balance_lock g
    ON g.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND g.organization_id = '{{node:code_node_rZGbQJid.data.organizationId}}'
   AND g.lock_key = CONCAT('GATE|', '{{node:code_node_rZGbQJid.data.operationId}}')
  LEFT JOIN gd_publish_step st
    ON st.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND st.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND st.step_name = 'P3_INVENTORY_APPLY'
   AND st.is_deleted = 0