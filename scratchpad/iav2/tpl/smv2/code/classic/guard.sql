SELECT g.stock_movement_status,
       (SELECT COUNT(*) FROM sm_location_transfer_d2c7o1jd_sub l
         WHERE l.tenant_id = '{{node:code_node_LOTguard.data.tenantId}}'
           AND l.sm_location_transfer_id = g.id
           AND l.is_deleted = 0
           AND NOT (COALESCE(l.item_bundle_id, '') <> '' AND l.parent_id IS NULL)) AS line_count
  FROM sm_location_transfer g
 WHERE g.tenant_id = '{{node:code_node_LOTguard.data.tenantId}}'
   AND g.id = {{node:code_node_LOTguard.data.lotId}}
   AND g.is_deleted = 0
