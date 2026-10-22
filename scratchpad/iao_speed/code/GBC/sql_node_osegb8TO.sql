SELECT CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.lease_owner,
       DATE_FORMAT(j.lease_expires_at, '%Y-%m-%d %H:%i:%s') AS lease_expires_at,
       j.row_version,
       CAST(j.gd_id AS CHAR) AS gd_id
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND j.id = {{node:code_node_WaEyJtlE.data.jobId}}