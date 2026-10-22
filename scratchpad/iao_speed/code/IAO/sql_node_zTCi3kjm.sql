SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s.%f') AS db_now_f,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(o.id AS CHAR) AS id,
       o.operation_id,
       o.request_hash,
       o.operation_status,
       o.result_code,
       o.effect_summary,
       o.review_reference,
       DATE_FORMAT(o.mutation_started_at, '%Y-%m-%d %H:%i:%s.%f') AS mutation_started_at,
       DATE_FORMAT(o.lease_expires_at, '%Y-%m-%d %H:%i:%s.%f') AS lease_expires_at,
       DATE_FORMAT(o.completed_at, '%Y-%m-%d %H:%i:%s') AS completed_at,
       o.row_version,
       o.is_deleted,
       (g.id IS NOT NULL) AS gate_taken,
       g.owner_operation_id AS gate_owner,
       CAST(orig.id AS CHAR) AS orig_id,
       orig.operation_status AS orig_status,
       orig.is_deleted AS orig_deleted,
       (SELECT COUNT(*) FROM inventory_operation x
         WHERE x.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
           AND x.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
           AND x.organization_id <> '{{node:code_node_cW0Exw93.data.organizationId}}') AS other_org_ops,
       (SELECT COUNT(*) FROM inventory_operation_effect y
         WHERE y.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
           AND y.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
           AND y.organization_id <> '{{node:code_node_cW0Exw93.data.organizationId}}') AS other_org_effects
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN inventory_operation o
    ON o.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND o.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND o.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
  LEFT JOIN inventory_balance_lock g
    ON g.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND g.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND g.lock_key = CONCAT('GATE|', '{{node:code_node_cW0Exw93.data.operationId}}')
  LEFT JOIN inventory_operation orig
    ON orig.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND orig.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND orig.operation_id = '{{node:code_node_cW0Exw93.data.originalOperationId}}'