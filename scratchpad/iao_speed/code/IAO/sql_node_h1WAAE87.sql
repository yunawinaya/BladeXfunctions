SELECT 'FIFO' AS kind, f.id AS sort_id, CAST(f.id AS CHAR) AS id,
       CAST(f.material_id AS CHAR) AS material_id,
       CAST(COALESCE(f.batch_id, 0) AS CHAR) AS batch_id,
       f.fifo_sequence AS fifo_sequence,
       CAST(f.fifo_cost_price AS CHAR) AS fifo_cost_price,
       CAST(f.fifo_available_quantity AS CHAR) AS fifo_available_quantity,
       '' AS wa_cost_price
  FROM fifo_costing_history f
 WHERE f.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND f.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND f.plant_id = {{node:code_node_cW0Exw93.data.plantId}}
   AND f.is_deleted = 0
   AND (f.material_id, COALESCE(f.batch_id, 0)) IN ({{node:code_node_cW0Exw93.data.costKeysSql}})
UNION ALL
SELECT 'WA' AS kind, w.id AS sort_id, CAST(w.id AS CHAR) AS id,
       CAST(w.material_id AS CHAR) AS material_id,
       CAST(COALESCE(w.batch_id, 0) AS CHAR) AS batch_id,
       '' AS fifo_sequence,
       '' AS fifo_cost_price,
       '' AS fifo_available_quantity,
       CAST(w.wa_cost_price AS CHAR) AS wa_cost_price
  FROM wa_costing_method w
 WHERE w.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND w.organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND w.plant_id = '{{node:code_node_cW0Exw93.data.plantId}}'
   AND w.is_deleted = 0
   AND (w.material_id, COALESCE(w.batch_id, 0)) IN ({{node:code_node_cW0Exw93.data.costKeysSql}})
 ORDER BY kind, sort_id