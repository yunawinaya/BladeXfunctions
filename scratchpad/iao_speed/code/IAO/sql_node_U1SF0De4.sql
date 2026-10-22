SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now,
       (SELECT COUNT(*) FROM blade_dept d
         WHERE d.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}' AND d.is_deleted = 0
           AND d.id = {{node:code_node_cW0Exw93.data.organizationId}} AND d.parent_id = 0) AS org_ok,
       (SELECT COUNT(*) FROM blade_dept p
         WHERE p.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}' AND p.is_deleted = 0
           AND p.id = {{node:code_node_cW0Exw93.data.plantId}} AND (p.id = {{node:code_node_cW0Exw93.data.organizationId}} OR p.parent_id = {{node:code_node_cW0Exw93.data.organizationId}})) AS plant_ok,
       (SELECT COALESCE(u.dept_id, '') FROM blade_user u
         WHERE u.tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}' AND u.is_deleted = 0
           AND u.id = {{node:code_node_cW0Exw93.data.requestedBy}} LIMIT 1) AS user_depts