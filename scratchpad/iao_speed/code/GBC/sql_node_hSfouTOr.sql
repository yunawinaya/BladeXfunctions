SELECT j.prepared_payload AS prepared_payload
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND j.id = {{node:code_node_WaEyJtlE.data.jobId}}