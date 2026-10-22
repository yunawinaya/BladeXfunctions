SELECT CAST(s.id AS CHAR) AS id,
       s.so_no,
       CASE WHEN s.so_no = '{{node:code_node_SCgate.data.tempNo}}' THEN 'TEMP' ELSE 'DRAFT' END AS kind,
       (SELECT p.result_ref FROM gd_publish_step p
         WHERE p.tenant_id = '{{node:code_node_SCguard.data.tenantId}}' AND p.is_deleted = 0 AND p.step_name LIKE 'LOCK|%'
           AND p.job_id = (CONCAT('SOS|', CAST(s.id AS CHAR)) COLLATE utf8mb4_general_ci) ORDER BY p.id DESC LIMIT 1) AS lock_ref
  FROM sales_order s
 WHERE s.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'
   AND s.is_deleted = 0
   AND s.organization_id = '{{node:code_node_SCgate.data.organizationId}}'
   AND (s.so_no = '{{node:code_node_SCgate.data.tempNo}}'
        OR (s.so_status = 'Draft'
            AND COALESCE(s.is_processing, 0) = 1
            AND s.create_user = (SELECT j.create_user FROM gd_async_job j WHERE j.tenant_id = '{{node:code_node_SCguard.data.tenantId}}' AND j.id = {{node:code_node_SCgate.data.jobId}})
            AND s.create_time >= '{{node:code_node_SCa.data.draftSince}}'))