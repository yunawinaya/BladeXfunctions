SELECT j.job_status,
       j.progress_percent,
       j.progress_message,
       j.error_code,
       j.error_message,
       j.error_details,
       j.confirmation_token
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_SWguard.data.tenantId}}'
   AND j.id = {{node:code_node_SWguard.data.jobIdSql}}
   AND j.is_deleted = 0