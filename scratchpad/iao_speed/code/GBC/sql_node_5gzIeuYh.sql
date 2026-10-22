SELECT CAST(st.id AS CHAR) AS id,
       st.step_name,
       st.step_status,
       st.attempt_count,
       st.inventory_operation_id,
       st.result_ref,
       st.error_code,
       st.error_message
  FROM gd_publish_step st
 WHERE st.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND st.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND st.is_deleted = 0