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
       CAST(m.id AS CHAR) AS id,
       m.operation_effect_key AS operation_effect_key,
       m.transaction_type AS transaction_type,
       m.trx_no AS trx_no,
       m.parent_trx_no AS parent_trx_no,
       m.inventory_category AS inventory_category,
       m.movement AS movement,
       m.costing_method_id AS costing_method_id,
       m.organization_id AS organization_id,
       CAST(m.unit_price AS CHAR) AS unit_price,
       CAST(m.total_price AS CHAR) AS total_price,
       CAST(m.quantity AS CHAR) AS quantity,
       CAST(m.base_qty AS CHAR) AS base_qty,
       CAST(m.actual_qty AS CHAR) AS actual_qty,
       CAST(m.actual_base_qty AS CHAR) AS actual_base_qty,
       CAST(m.uom_id AS CHAR) AS uom_id,
       CAST(m.base_uom_id AS CHAR) AS base_uom_id,
       CAST(m.item_id AS CHAR) AS item_id,
       CAST(m.bin_location_id AS CHAR) AS bin_location_id,
       CAST(m.batch_number_id AS CHAR) AS batch_number_id,
       CAST(m.plant_id AS CHAR) AS plant_id,
       DATE_FORMAT(m.doc_date, '%Y-%m-%d %H:%i:%s') AS doc_date,
       DATE_FORMAT(m.manufacturing_date, '%Y-%m-%d %H:%i:%s') AS manufacturing_date,
       DATE_FORMAT(m.expired_date, '%Y-%m-%d %H:%i:%s') AS expired_date,
       m.is_deleted AS is_deleted
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
  LEFT JOIN inventory_movement m
    ON m.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND m.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND m.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND NULLIF(m.operation_effect_key, '') IN ({{node:code_node_cW0Exw93.data.movementKeysSql}})