SELECT (EXISTS (SELECT 1
                  FROM goods_delivery g
                 WHERE '{{node:code_node_SPgate.data.soId}}' <> '0'
                   AND g.tenant_id = '{{system:tenantId}}'
                   AND g.is_deleted = 0
                   AND COALESCE(g.gd_status, '') <> 'Cancelled'
                   AND (JSON_CONTAINS(g.so_id, '{{node:code_node_SPgate.data.soId}}') OR JSON_CONTAINS(g.so_id, JSON_QUOTE('{{node:code_node_SPgate.data.soId}}'))))
     OR EXISTS (SELECT 1
                  FROM picking_plan p
                 WHERE '{{node:code_node_SPgate.data.soId}}' <> '0'
                   AND p.tenant_id = '{{system:tenantId}}'
                   AND p.is_deleted = 0
                   AND COALESCE(p.to_status, '') <> 'Cancelled'
                   AND (JSON_CONTAINS(p.so_id, '{{node:code_node_SPgate.data.soId}}') OR JSON_CONTAINS(p.so_id, JSON_QUOTE('{{node:code_node_SPgate.data.soId}}'))))) AS linked