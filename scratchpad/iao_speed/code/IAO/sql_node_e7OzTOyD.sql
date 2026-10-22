SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 10 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(b.id AS CHAR) AS id,
       CAST(b.material_id AS CHAR) AS material_id,
       CAST(b.location_id AS CHAR) AS location_id,
       CAST(b.material_uom AS CHAR) AS material_uom,
       CAST(b.unrestricted_qty AS CHAR) AS unrestricted_qty,
       CAST(b.reserved_qty AS CHAR) AS reserved_qty,
       CAST(b.block_qty AS CHAR) AS block_qty,
       CAST(b.qualityinsp_qty AS CHAR) AS qualityinsp_qty,
       CAST(b.intransit_qty AS CHAR) AS intransit_qty,
       CAST(b.balance_quantity AS CHAR) AS balance_quantity,
       DATE_FORMAT(b.update_time, '%Y-%m-%d %H:%i:%s.%f') AS updated_at
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN item_balance b
    ON b.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND b.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND b.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND b.is_deleted = 0
   AND (b.material_id, b.location_id) IN ({{node:code_node_cW0Exw93.data.itemTuplesSql}})