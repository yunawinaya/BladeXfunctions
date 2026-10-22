SELECT r.step_name,
       r.result_ref
  FROM gd_publish_step r
 WHERE r.tenant_id = '{{node:code_node_SWguard.data.tenantId}}'
   AND r.is_deleted = 0
   AND r.step_status = 'PART'
   AND r.job_id = '{{node:code_node_SWpick.data.gRef}}'
   AND r.step_name = '{{node:code_node_SWpick.data.gPart}}'