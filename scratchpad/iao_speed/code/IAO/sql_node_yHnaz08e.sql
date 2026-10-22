SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(e.id AS CHAR) AS id,
       e.effect_key,
       e.effect_status
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN inventory_operation_effect e
    ON e.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND e.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND e.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND e.is_deleted = 0