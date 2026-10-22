SELECT CAST(id AS CHAR) AS id,
       lock_key,
       balance_type,
       free_token,
       owner_operation_id,
       lock_version,
       last_owner_operation_id,
       is_deleted,
       DATE_FORMAT(update_time, '%Y-%m-%d %H:%i:%s.%f') AS updated_at,
       DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now
  FROM inventory_balance_lock
 WHERE tenant_id = '{{node:code_node_cW0Exw93.data.tenantId}}'
   AND organization_id = '{{node:code_node_cW0Exw93.data.organizationId}}'
   AND lock_key IN ({{node:code_node_cW0Exw93.data.keyListSql}})
 ORDER BY lock_key