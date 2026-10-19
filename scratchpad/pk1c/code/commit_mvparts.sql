SELECT s.step_name, s.result_ref
  FROM gd_publish_step s
 WHERE s.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND s.job_id = '{{node:code_node_PCguard.data.jobId}}'
   AND s.step_name LIKE 'MV|{{node:code_node_PCentry.data.moveNonce}}|%'
   AND s.step_status = 'PAYLOAD'
 ORDER BY s.step_name
