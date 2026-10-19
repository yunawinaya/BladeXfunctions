SELECT CAST(t.id AS CHAR) AS id,
       t.to_id,
       t.to_status,
       t.is_deleted,
       t.organization_id,
       CAST(t.plant_id AS CHAR) AS plant_id,
       COALESCE(t.is_loading_bay, 0) AS is_loading_bay,
       CAST(t.gd_no AS CHAR) AS gd_no_json,
       t.delivery_no,
       t.so_no,
       ps.picking_after,
       CAST(ps.allow_full_picking AS CHAR) AS allow_full_picking,
       CAST(ps.auto_completed_gd AS CHAR) AS auto_completed_gd,
       CAST(ps.is_loading_bay AS CHAR) AS setup_loading_bay,
       CAST(pk.packing_required AS CHAR) AS packing_required,
       CAST(pk.auto_trigger_pkg AS CHAR) AS auto_trigger_pkg,
       pk.packing_mode
  FROM (SELECT 1 AS one) o
  LEFT JOIN transfer_order t
    ON t.tenant_id = '{{node:code_node_PPguard.data.tenantId}}'
   AND t.id = {{node:code_node_PPentry.data.pickingId}}
  LEFT JOIN (SELECT p.picking_after, p.allow_full_picking, p.auto_completed_gd, p.is_loading_bay
               FROM picking_setup p
              WHERE p.tenant_id = '{{node:code_node_PPguard.data.tenantId}}'
                AND p.organization_id = '{{node:code_node_PPentry.data.organizationId}}'
                AND p.is_deleted = 0
              ORDER BY p.id
              LIMIT 1) ps
    ON 1 = 1
  LEFT JOIN (SELECT k.packing_required, k.auto_trigger_pkg, k.packing_mode
               FROM packing_setup k
              WHERE k.tenant_id = '{{node:code_node_PPguard.data.tenantId}}'
                AND k.organization_id = '{{node:code_node_PPentry.data.organizationId}}'
                AND k.is_deleted = 0
              ORDER BY k.id
              LIMIT 1) pk
    ON 1 = 1