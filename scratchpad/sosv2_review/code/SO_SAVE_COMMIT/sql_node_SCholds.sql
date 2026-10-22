SELECT CAST(h.id AS CHAR) AS id,
       h.job_status
  FROM gd_async_job h
 WHERE h.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND h.is_deleted = 0
   AND h.id IN ({{node:code_node_SCgate.data.holdIdsSql}})