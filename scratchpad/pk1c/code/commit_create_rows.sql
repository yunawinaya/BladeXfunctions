SELECT CAST('C' AS CHAR) AS k, CAST(JSON_OBJECT('id', CAST(r.id AS CHAR), 'job_line_key', r.job_line_key) AS CHAR) AS j
  FROM on_reserved_gd r
 WHERE r.tenant_id = '{{node:code_node_PCguard.data.tenantId}}'
   AND r.job_line_key LIKE '{{node:code_node_PCguard.data.jobId}}|R|%'
   AND r.is_deleted = 0
