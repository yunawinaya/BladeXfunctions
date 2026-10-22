SELECT CAST(st.id AS CHAR) AS id,
       st.stable_line_key,
       st.allocation_sequence,
       st.gd_line_index,
       st.line_status,
       st.effect_key_out,
       st.effect_key_in,
       CAST(st.base_qty AS CHAR) AS base_qty,
       st.costing_input,
       st.gd_line_id
  FROM gd_bulk_line_stage st
 WHERE st.tenant_id = '{{node:code_node_WaEyJtlE.data.tenantId}}'
   AND st.job_id = '{{node:code_node_WaEyJtlE.data.jobId}}'
   AND st.is_deleted = 0
 ORDER BY st.gd_line_index, st.allocation_sequence