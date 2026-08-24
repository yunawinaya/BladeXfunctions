-- ============================================================================
-- One-off data fix: SRR/20260824/0018 posted into a junk batch
--
-- Cause: SRRbatchAddLineItem stamped the UI placeholder "Auto-generated batch
-- number" into batch_no regardless of new_batch, and this plant runs
-- sales_return_setup.generate_new_batch = 0. The save workflow's "IF newBatch?"
-- gate therefore skipped batch generation, and ADD_INVENTORY created a batch
-- literally named "Auto-generated batch number" instead of returning the stock
-- into the batch it was delivered from.
--
-- The 2 units are physically on the shelf and the batch-agnostic totals are
-- already right (item_balance 2086993807890583554 = 2.000, and it equals the
-- sum of the batch rows at that bin). Only the batch attribution is wrong, so
-- this moves the attribution and leaves every total untouched.
--
-- Environment : PROD (tenant 035843, org 1993950065513086977)
-- Verified against prod on 2026-08-24. Re-run section 1 before executing:
-- if any pre-check value has moved, STOP and re-derive.
--
--   junk batch    2091768141687427073  "Auto-generated batch number"
--   correct batch 2047529665724129281  "2601-234"
--   plant         1993950927744548865
--   bin           2046431735523745794
--
-- Every statement is guarded on its current value, so it either changes
-- exactly 1 row or 0 rows. A statement reporting 0 rows means the state is not
-- what this script was written against -- ROLLBACK and investigate.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. PRE-CHECK  (run first, compare against the expected values in comments)
-- ---------------------------------------------------------------------------

-- expect exactly 2 rows: 2601-234 at 0.000, and the junk batch holding 2.000
SELECT ibb.id, ibb.batch_id, b.batch_number, ibb.unrestricted_qty, ibb.balance_quantity
FROM   item_batch_balance ibb
LEFT   JOIN batch b ON b.id = ibb.batch_id
WHERE  ibb.material_id = 2036389303434174652
AND    ibb.location_id = 2046431735523745794
AND    ibb.plant_id    = 1993950927744548865
AND    ibb.is_deleted  = 0
ORDER  BY ibb.id;

-- expect sum_batch_rows = item_balance_row = 2.000  (must still match after the fix)
SELECT (SELECT SUM(balance_quantity) FROM item_batch_balance
        WHERE material_id = 2036389303434174652
        AND   location_id = 2046431735523745794
        AND   plant_id    = 1993950927744548865
        AND   is_deleted  = 0)                              AS sum_batch_rows,
       (SELECT balance_quantity FROM item_balance
        WHERE id = 2086993807890583554)                     AS item_balance_row;

-- expect a single row: fifo_sequence = 1  (so the corrected row becomes 2)
SELECT id, fifo_sequence, fifo_initial_quantity, fifo_available_quantity
FROM   fifo_costing_history
WHERE  material_id     = 2036389303434174652
AND    batch_id        = 2047529665724129281
AND    plant_id        = 1993950927744548865
AND    organization_id = '1993950065513086977'
AND    is_deleted      = 0
ORDER  BY CAST(fifo_sequence AS UNSIGNED);


-- ---------------------------------------------------------------------------
-- 2. FIX  (each statement must report exactly 1 row changed)
-- ---------------------------------------------------------------------------

START TRANSACTION;

-- 2a. Credit the 2 units to the batch they were delivered from. Absolute
--     values, not += , so a re-run cannot double-apply.
UPDATE item_batch_balance
SET    unrestricted_qty = 2.000,
       balance_quantity = 2.000,
       update_time      = NOW(3)
WHERE  id               = 2086993807794114561
AND    batch_id         = 2047529665724129281
AND    unrestricted_qty = 0.000
AND    balance_quantity = 0.000
AND    is_deleted       = 0;

-- 2b. Retire the junk batch's balance row.
UPDATE item_batch_balance
SET    is_deleted  = 1,
       update_time = NOW(3)
WHERE  id          = 2091768141913919489
AND    batch_id    = 2091768141687427073
AND    is_deleted  = 0;

-- 2c. Re-point the FIFO layer. Sequence must become 2 -- sequence 1 already
--     exists for this (material, batch, plant, org), and ADD_INVENTORY keys
--     the sequence on exactly those four columns.
UPDATE fifo_costing_history
SET    batch_id      = 2047529665724129281,
       fifo_sequence = '2',
       update_time   = NOW(3)
WHERE  id            = 2091768142199132162
AND    batch_id      = 2091768141687427073
AND    is_deleted    = 0;

-- 2d. Re-point the inventory movement (column is batch_number_id, not batch_id).
UPDATE inventory_movement
SET    batch_number_id = 2047529665724129281,
       update_time     = NOW(3)
WHERE  id              = 2091768141775507457
AND    batch_number_id = 2091768141687427073
AND    is_deleted      = 0;

-- 2e. Fix the SRR line so the document reads correctly and any re-save or
--     reversal resolves the right batch.
UPDATE sales_return_receiving_05z4r94a_sub
SET    batch_id    = 2047529665724129281,
       batch_no    = '2601-234',
       update_time = NOW(3)
WHERE  id          = 2091768138696888322
AND    batch_no    = 'Auto-generated batch number'
AND    is_deleted  = 0;

-- 2f. Retire the junk batch itself.
UPDATE batch
SET    is_deleted   = 1,
       update_time  = NOW(3)
WHERE  id           = 2091768141687427073
AND    batch_number = 'Auto-generated batch number'
AND    is_deleted   = 0;


-- ---------------------------------------------------------------------------
-- 3. POST-CHECK  (run inside the same transaction, BEFORE committing)
-- ---------------------------------------------------------------------------

-- expect ONE row: 2601-234 holding 2.000 / 2.000
SELECT ibb.id, ibb.batch_id, b.batch_number, ibb.unrestricted_qty, ibb.balance_quantity
FROM   item_batch_balance ibb
LEFT   JOIN batch b ON b.id = ibb.batch_id
WHERE  ibb.material_id = 2036389303434174652
AND    ibb.location_id = 2046431735523745794
AND    ibb.plant_id    = 1993950927744548865
AND    ibb.is_deleted  = 0
ORDER  BY ibb.id;

-- expect sum_batch_rows = item_balance_row = 2.000  (unchanged by the fix)
SELECT (SELECT SUM(balance_quantity) FROM item_batch_balance
        WHERE material_id = 2036389303434174652
        AND   location_id = 2046431735523745794
        AND   plant_id    = 1993950927744548865
        AND   is_deleted  = 0)                              AS sum_batch_rows,
       (SELECT balance_quantity FROM item_balance
        WHERE id = 2086993807890583554)                     AS item_balance_row;

-- expect sequences 1 (available 0.000) and 2 (available 2.000), no duplicates
SELECT id, fifo_sequence, fifo_initial_quantity, fifo_available_quantity, fifo_cost_price
FROM   fifo_costing_history
WHERE  material_id     = 2036389303434174652
AND    batch_id        = 2047529665724129281
AND    plant_id        = 1993950927744548865
AND    organization_id = '1993950065513086977'
AND    is_deleted      = 0
ORDER  BY CAST(fifo_sequence AS UNSIGNED);

-- expect 0 rows everywhere: nothing live still points at the junk batch
SELECT 'item_batch_balance' AS src, COUNT(*) AS n FROM item_batch_balance   WHERE batch_id        = 2091768141687427073 AND is_deleted = 0
UNION ALL
SELECT 'fifo_costing_history',      COUNT(*)      FROM fifo_costing_history WHERE batch_id        = 2091768141687427073 AND is_deleted = 0
UNION ALL
SELECT 'inventory_movement',        COUNT(*)      FROM inventory_movement   WHERE batch_number_id = 2091768141687427073 AND is_deleted = 0
UNION ALL
SELECT 'batch',                     COUNT(*)      FROM batch                WHERE id              = 2091768141687427073 AND is_deleted = 0
UNION ALL
SELECT 'srr_line_placeholder',      COUNT(*)      FROM sales_return_receiving_05z4r94a_sub
                                                  WHERE batch_no = 'Auto-generated batch number' AND is_deleted = 0;

-- expect the SRR line reading 2601-234
SELECT id, sr_line_id, batch_id, batch_no, received_qty
FROM   sales_return_receiving_05z4r94a_sub
WHERE  id = 2091768138696888322;


-- COMMIT;    -- uncomment only once every post-check above matches
-- ROLLBACK;  -- if anything reported 0 rows changed or an unexpected value
