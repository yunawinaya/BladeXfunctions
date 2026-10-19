SELECT s.step_name, s.result_ref
  FROM gd_publish_step s
 WHERE s.tenant_id = '{{node:code_node_PPentry.data.tenantId}}'
   AND s.job_id = '{{node:code_node_PPentry.data.jobId}}'
   AND s.step_name LIKE 'MV|{{node:code_node_PPmove.data.nonce}}|%'
   AND s.step_status = 'PAYLOAD'
   AND s.step_name NOT LIKE 'MV|%|ALC|%'
 ORDER BY s.step_name
