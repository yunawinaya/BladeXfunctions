-- Kenhin: undo migrate.sql, only while the WA row is untouched (no delivery has used it since).
-- PART 1: expect 1 untouched WA row(s)
SELECT COUNT(*) AS untouched FROM wa_costing_method WHERE tenant_id = '528521' AND id IN (2116017246831546368) AND create_time = update_time;

-- PART 2: expected rows affected: 2, then 1
UPDATE fifo_costing_history SET is_deleted = 0, update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '528521' AND is_deleted = 1 AND id IN (2058950305406959618, 2102972534688452610)
   AND EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = '528521' AND w.id IN (2116017246831546368) AND w.create_time = w.update_time);
DELETE FROM wa_costing_method WHERE tenant_id = '528521' AND id IN (2116017246831546368) AND create_time = update_time;
