-- LSH (tenant 128671): remove the empty GD Created V2 Packing shells whose delivery has no Picking yet.
-- A shell is removed only if: Created, the save-time key PKG|<gd_id>, not open in the form, no item / HU-source / HU row,
-- its delivery is Created with no live Picking, and no background job is open on that delivery.
-- prod datetimes are MYT wall-clock read in a UTC session (packing_lock_expires_at is a TIMESTAMP column)
SET time_zone = '+00:00';

SELECT CAST(p.id AS CHAR) AS id, p.packing_no, p.gd_no, p.create_time, p.packing_lock_updated_at
  FROM packing p
 WHERE p.tenant_id = '128671'
   AND p.is_deleted = 0
   AND p.packing_status = 'Created'
   AND p.idempotency_key = CONCAT('PKG|', p.gd_id)
   AND (p.packing_lock_expires_at IS NULL OR p.packing_lock_expires_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))
   AND COALESCE(p.packing_lock_session_id, '') NOT LIKE 'PKGJOB-%'
   AND p.id NOT IN (SELECT pid FROM (
         SELECT packing_id AS pid FROM packing_jz8m9w3h_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL
         UNION SELECT packing_id FROM packing_mudjw4xk_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL
         UNION SELECT packing_id FROM packing_hr4nq20g_sub WHERE tenant_id = '128671' AND is_deleted = 0 AND packing_id IS NOT NULL) AS has_rows)
   AND EXISTS (SELECT 1 FROM goods_delivery g
                WHERE g.id = CAST(p.gd_id AS UNSIGNED) AND g.tenant_id = p.tenant_id AND g.is_deleted = 0
                  AND g.gd_status = 'Created' AND COALESCE(g.picking_status, '') IN ('', 'Not Created'))
   AND CAST(p.gd_id AS UNSIGNED) NOT IN (SELECT gid FROM (
         SELECT tg.goods_delivery_id AS gid
           FROM transfer_order_goods_delivery tg JOIN transfer_order t ON t.id = tg.transfer_order_id
          WHERE tg.tenant_id = '128671' AND tg.is_deleted = 0 AND tg.goods_delivery_id IS NOT NULL
            AND t.is_deleted = 0 AND COALESCE(t.to_status, '') <> 'Cancelled') AS picked)
   AND p.gd_id NOT IN (SELECT gid FROM (
         SELECT SUBSTRING(correlation_id, 4) AS gid FROM gd_async_job
          WHERE tenant_id = '128671' AND is_deleted = 0 AND correlation_id LIKE 'GD|%'
            AND job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')) AS busy)
 ORDER BY p.packing_no;
