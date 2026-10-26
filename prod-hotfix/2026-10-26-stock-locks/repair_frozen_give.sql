-- 2026-10-26 ~11:10-11:33: give back the stock keys of 2 operations frozen in their give-back by engine v13
-- (INVENTORY_APPLY_OPERATION, pasted 11:06:39, rolled back to v12 by ROLLBACK_INVENTORY_APPLY_OPERATION_prod_v12.json).
-- v13 took every key in one call but still gave keys back in parallel lanes, which cannot release keys the main call took.
-- Both operations are DONE / OK (stock moved correctly); only their give-back stopped:
--   LSH (128671)  PKG|2114555645465333762|1  25 keys given back, 67 left at free_token 0
--   GUB (900938)  GD|2114555054513065986|1   25 keys given back,  6 left at free_token 0  (GD-26/10/0544)
--
-- RUN ONLY AFTER the GD session confirms both frozen runs have ended (platform 20-min limit, ~11:31 / ~11:33). Once they end
-- they may finish their own give-back, as the 07:51 lane did; running this first would make those tokens 2.
-- It only touches rows still in the frozen state (token 0, owner already cleared by the release's step 1, last owner =
-- the operation), exactly what the give-back's atomic plus(1) would have changed, so a re-run changes nothing.

START TRANSACTION;

UPDATE inventory_balance_lock
   SET free_token = 1,
       update_time = DATE_ADD(NOW(3), INTERVAL 8 HOUR)
 WHERE tenant_id IN ('128671', '900938')
   AND is_deleted = 0
   AND free_token = 0
   AND owner_operation_id = ''
   AND last_owner_operation_id IN ('PKG|2114555645465333762|1', 'GD|2114555054513065986|1');
-- expect: 73 rows affected (67 + 6), or fewer if the runs gave some back when they ended - the GD session gives the exact
-- count before you run it

-- If the count matches: COMMIT;   otherwise: ROLLBACK; and tell me the count.
