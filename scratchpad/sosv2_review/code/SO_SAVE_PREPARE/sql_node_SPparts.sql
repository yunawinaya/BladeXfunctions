SELECT r.step_name,
       r.result_ref
  FROM gd_publish_step r
 WHERE r.tenant_id = '{{node:code_node_SPguard.data.tenantId}}'
   AND r.is_deleted = 0
   AND r.step_status = 'PART'
   AND r.job_id = 'SOR|{{node:code_node_SPgate.data.requestNonce}}'
   AND r.step_name LIKE 'R|%'
 ORDER BY r.step_name