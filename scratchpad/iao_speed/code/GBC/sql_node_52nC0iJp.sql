SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       DATE_FORMAT(n.t + INTERVAL 30 MINUTE, '%Y-%m-%d %H:%i:%s') AS lease_until,
       CAST(j.id AS CHAR) AS id,
       j.job_status,
       j.lease_owner
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND j.id = {{node:code_node_WaEyJtlE.data.jobId}}
   AND j.is_deleted = 0