-- PTS (tenant 035843) GD/2610/1010: finish the stuck GD Cancel V2 job 2115361765603807234 with the cancelled number GD/2610/1010-Cancelled-2.
-- Why: PTS has two GDs numbered GD/2610/1010. The first (2115351788000514049) was cancelled at 16:15 and became GD/2610/1010-Cancelled; the second
-- (2115361119882317825) was created at 16:32 with the same number. Its cancel's last step (X6) renames it to GD/2610/1010-Cancelled, which the platform refuses
-- ("Next serial number is already in use"), so every retry fails there. X0-X5 are done: stock released, its Picking and stock
-- movements already renamed to GD/2610/1010-Cancelled. This gives the second GD its own cancelled number everywhere X5 wrote it, and in the cancel's
-- stored plan, so the next GD_CANCEL_WORKER run at PTS finishes X6 (GD header + lines) and X7 (item dates + reorder) itself.
-- Nothing of the first GD is touched (its 6 movements and 1 Picking row keep GD/2610/1010-Cancelled).

-- PART 1: checks (all must match)
SELECT job_status, lease_expires_at < UTC_TIMESTAMP() AS lease_expired,
       (SELECT COUNT(*) FROM gd_publish_step s WHERE s.tenant_id = '035843' AND s.job_id = '2115361765603807234' AND s.step_name = 'X6_GD' AND s.is_deleted = 0) AS x6_steps
  FROM gd_async_job WHERE tenant_id = '035843' AND id = 2115361765603807234;
--   expect: COMMITTING_GD | 1 | 0
SELECT delivery_no, gd_status FROM goods_delivery WHERE tenant_id = '035843' AND id = 2115361119882317825;
--   expect: GD/2610/1010 | Processing
SELECT (SELECT COUNT(*) FROM goods_delivery WHERE tenant_id = '035843' AND delivery_no = 'GD/2610/1010-Cancelled-2') AS gd_new,
       (SELECT COUNT(*) FROM transfer_order WHERE tenant_id = '035843' AND delivery_no LIKE '%GD/2610/1010-Cancelled-2%') AS picking_new,
       (SELECT COUNT(*) FROM gd_publish_step WHERE tenant_id = '035843' AND id IN (2115361770951544836, 2115361770951544840) AND result_ref LIKE '%GD/2610/1010-Cancelled%' AND result_ref NOT LIKE '%GD/2610/1010-Cancelled-2%') AS plan_rows,
       (SELECT COUNT(*) FROM transfer_order WHERE tenant_id = '035843' AND id = 2115361165260492802 AND delivery_no = 'GD/2610/1010-Cancelled') AS picking_header,
       (SELECT COUNT(*) FROM transfer_order_jz8m9w3h_sub WHERE tenant_id = '035843' AND id IN (2115361165340184579, 2115361165344378881, 2115361165344378882, 2115361165344378883) AND gd_id = '2115361119882317825' AND gd_no = 'GD/2610/1010-Cancelled') AS picking_rows,
       (SELECT COUNT(*) FROM inventory_movement WHERE tenant_id = '035843' AND id IN (2115361142867103746, 2115361142867103747, 2115361142867103748, 2115361142867103749, 2115361142867103750, 2115361142867103751, 2115361142867103752, 2115361142867103753, 2115361778157359106, 2115361778157359107, 2115361778157359108, 2115361778157359109, 2115361778157359110, 2115361778157359111, 2115361778157359112, 2115361778157359113) AND trx_no = 'GD/2610/1010-Cancelled') AS movements;
--   expect: 0 | 0 | 2 | 1 | 4 | 16

-- PART 2: the repair (expected rows affected: 2 / 1 / 4 / 16)
UPDATE gd_publish_step SET result_ref = REPLACE(result_ref, 'GD/2610/1010-Cancelled', 'GD/2610/1010-Cancelled-2'), update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '035843' AND job_id = '2115361765603807234' AND id IN (2115361770951544836, 2115361770951544840) AND result_ref NOT LIKE '%GD/2610/1010-Cancelled-2%';

UPDATE transfer_order SET delivery_no = 'GD/2610/1010-Cancelled-2', update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '035843' AND id = 2115361165260492802 AND delivery_no = 'GD/2610/1010-Cancelled';

UPDATE transfer_order_jz8m9w3h_sub SET gd_no = 'GD/2610/1010-Cancelled-2', update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '035843' AND id IN (2115361165340184579, 2115361165344378881, 2115361165344378882, 2115361165344378883) AND gd_id = '2115361119882317825' AND gd_no = 'GD/2610/1010-Cancelled';

UPDATE inventory_movement SET trx_no = 'GD/2610/1010-Cancelled-2', update_time = CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')
 WHERE tenant_id = '035843' AND id IN (2115361142867103746, 2115361142867103747, 2115361142867103748, 2115361142867103749, 2115361142867103750, 2115361142867103751, 2115361142867103752, 2115361142867103753, 2115361778157359106, 2115361778157359107, 2115361778157359108, 2115361778157359109, 2115361778157359110, 2115361778157359111, 2115361778157359112, 2115361778157359113) AND trx_no = 'GD/2610/1010-Cancelled';

-- PART 3: after-checks
SELECT (SELECT COUNT(*) FROM gd_publish_step WHERE tenant_id = '035843' AND id IN (2115361770951544836, 2115361770951544840) AND result_ref LIKE '%GD/2610/1010-Cancelled-2%') AS plan_rows,
       (SELECT COUNT(*) FROM transfer_order WHERE tenant_id = '035843' AND id = 2115361165260492802 AND delivery_no = 'GD/2610/1010-Cancelled-2') AS picking_header,
       (SELECT COUNT(*) FROM transfer_order_jz8m9w3h_sub WHERE tenant_id = '035843' AND gd_id = '2115361119882317825' AND gd_no = 'GD/2610/1010-Cancelled-2') AS picking_rows,
       (SELECT COUNT(*) FROM inventory_movement WHERE tenant_id = '035843' AND id IN (2115361142867103746, 2115361142867103747, 2115361142867103748, 2115361142867103749, 2115361142867103750, 2115361142867103751, 2115361142867103752, 2115361142867103753, 2115361778157359106, 2115361778157359107, 2115361778157359108, 2115361778157359109, 2115361778157359110, 2115361778157359111, 2115361778157359112, 2115361778157359113) AND trx_no = 'GD/2610/1010-Cancelled-2') AS movements;
--   expect: 2 | 1 | 4 | 16
-- Then, at the next GD_CANCEL_WORKER run at PTS (a PTS user's GD list nudges it), the job completes and GD 2115361119882317825 becomes Cancelled
-- with delivery_no GD/2610/1010-Cancelled-2.
