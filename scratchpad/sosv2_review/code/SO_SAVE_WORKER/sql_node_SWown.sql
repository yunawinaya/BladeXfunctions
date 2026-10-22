SELECT j.row_version,
       j.lease_owner
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_SWguard.data.tenantId}}'
   AND j.id = {{node:code_node_SWguard.data.jobIdSql}}
   AND j.is_deleted = 0