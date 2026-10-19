SELECT CAST('I' AS CHAR) AS k, CAST(COUNT(*) AS CHAR) AS j
  FROM gd_publish_step s
 WHERE s.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND s.job_id = '{{node:code_node_PCentry.data.moveOpKey}}'
   AND s.step_name LIKE 'IBA|I|%'
