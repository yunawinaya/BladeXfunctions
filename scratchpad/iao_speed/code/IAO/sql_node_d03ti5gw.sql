SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       o.operation_status AS op_status,
       DATE_FORMAT(o.mutation_started_at, '%Y-%m-%d %H:%i:%s') AS op_started,
       g.owner_operation_id AS gate_owner,
       (SELECT COUNT(*) FROM inventory_balance_lock l
         WHERE l.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
           AND l.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
           AND l.owner_operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
           AND l.balance_type IN ('ITEM', 'BATCH', 'HU', 'RESERVATION')
           AND l.free_token = 0
           AND l.is_deleted = 0) AS locks_owned,
       'item_balance' AS tbl,
       CAST(b.id AS CHAR) AS id,
       CAST(b.material_id AS CHAR) AS material_id,
       '' AS batch_id,
       CAST(b.location_id AS CHAR) AS location_id,
       CAST(b.material_uom AS CHAR) AS material_uom,
       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty,
       CAST(b.reserved_qty AS CHAR) AS reserved_qty,
       CAST(b.block_qty AS CHAR) AS block_qty,
       CAST(b.qualityinsp_qty AS CHAR) AS qualityinsp_qty,
       CAST(b.intransit_qty AS CHAR) AS intransit_qty,
       CAST(b.balance_quantity AS CHAR) AS balance_quantity,
       b.is_deleted AS is_deleted,
       DATE_FORMAT(b.update_time, '%Y-%m-%d %H:%i:%s.%f') AS updated_at
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN inventory_operation o
    ON o.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND o.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND o.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND o.is_deleted = 0
  LEFT JOIN inventory_balance_lock g
    ON g.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND g.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND g.lock_key = CONCAT('GATE|', '{{node:code_node_cW0Exw93.data.operationId}}')
  LEFT JOIN item_balance b
    ON b.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND b.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND b.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND b.id IN ({{node:code_node_8rCPo75P.data.balanceIdsSql}})
UNION ALL
SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       o.operation_status AS op_status,
       DATE_FORMAT(o.mutation_started_at, '%Y-%m-%d %H:%i:%s') AS op_started,
       g.owner_operation_id AS gate_owner,
       (SELECT COUNT(*) FROM inventory_balance_lock l
         WHERE l.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
           AND l.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
           AND l.owner_operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
           AND l.balance_type IN ('ITEM', 'BATCH', 'HU', 'RESERVATION')
           AND l.free_token = 0
           AND l.is_deleted = 0) AS locks_owned,
       'item_batch_balance' AS tbl,
       CAST(b.id AS CHAR) AS id,
       CAST(b.material_id AS CHAR) AS material_id,
       CAST(b.batch_id AS CHAR) AS batch_id,
       CAST(b.location_id AS CHAR) AS location_id,
       CAST(b.material_uom AS CHAR) AS material_uom,
       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty,
       CAST(b.reserved_qty AS CHAR) AS reserved_qty,
       CAST(b.block_qty AS CHAR) AS block_qty,
       CAST(b.qualityinsp_qty AS CHAR) AS qualityinsp_qty,
       CAST(b.intransit_qty AS CHAR) AS intransit_qty,
       CAST(b.balance_quantity AS CHAR) AS balance_quantity,
       b.is_deleted AS is_deleted,
       DATE_FORMAT(b.update_time, '%Y-%m-%d %H:%i:%s.%f') AS updated_at
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN inventory_operation o
    ON o.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND o.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND o.operation_id = '{{node:code_node_cW0Exw93.data.operationId}}'
   AND o.is_deleted = 0
  LEFT JOIN inventory_balance_lock g
    ON g.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND g.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND g.lock_key = CONCAT('GATE|', '{{node:code_node_cW0Exw93.data.operationId}}')
  LEFT JOIN item_batch_balance b
    ON b.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND b.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND b.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND b.id IN ({{node:code_node_8rCPo75P.data.batchIdsSql}})