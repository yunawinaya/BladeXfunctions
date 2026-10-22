SELECT r.step_name,
       r.result_ref
  FROM gd_publish_step r
 WHERE r.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND r.is_deleted = 0
   AND r.step_status = 'PART'
   AND r.job_id = '{{node:code_node_SCgate.data.planRef}}'
   AND (r.step_name IN ('H|000', 'A|000') OR ('{{node:code_node_SCgate.data.isEdit}}' = 'NO' AND r.step_name LIKE 'L|%'))
 ORDER BY r.step_name