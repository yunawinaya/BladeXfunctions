-- R4  BUG-010  Empty HUs left "Packed" by mobile unloads (LSH, tenant 128671)
-- ---------------------------------------------------------------------------------------------
-- 19 HUs have item_count 0 and no packing claim but still read "Packed", so Select Existing HU
-- treats them as occupied. HU/0125 and HU/0187 also keep 5 quantity-0 item rows from 09-24/25.
-- After HANDLING_UNIT is deployed, new unloads that empty an HU set it to Created themselves.
-- Run in Bytebase on PROD with backup ON. Step A before step B.
-- ---------------------------------------------------------------------------------------------

-- BEFORE (expect 19 rows, all item_count 0, packing_id empty)
SELECT id, handling_no, hu_status, item_count, total_quantity, packing_id
FROM handling_unit
WHERE tenant_id = '128671' AND is_deleted = 0 AND item_count = 0 AND hu_status = 'Packed'
ORDER BY handling_no;

-- BEFORE (expect 5 rows, quantity 0: 2 on HU/0125, 3 on HU/0187)
SELECT h.handling_no, s.id, s.quantity
FROM handling_unit h
JOIN handling_unit_atu7sreg_sub s ON s.handling_unit_id = h.id AND s.is_deleted = 0
WHERE h.tenant_id = '128671' AND h.is_deleted = 0 AND h.item_count = 0 AND h.hu_status = 'Packed';

-- FIX A: drop the quantity-0 item rows (expect 5 rows affected)
UPDATE handling_unit_atu7sreg_sub
SET is_deleted = 1
WHERE tenant_id = '128671' AND is_deleted = 0 AND quantity = 0
  AND id IN (2103023364061925378, 2103023364061925379,
             2103180080602812417, 2103180080602812418, 2103180080602812419);

-- FIX B: empty HUs become reusable (expect 19 rows affected)
UPDATE handling_unit h
SET h.hu_status = 'Created'
WHERE h.tenant_id = '128671' AND h.is_deleted = 0
  AND h.hu_status = 'Packed' AND h.item_count = 0
  AND (h.packing_id IS NULL OR h.packing_id = '')
  AND NOT EXISTS (SELECT 1 FROM handling_unit_atu7sreg_sub s
                  WHERE s.handling_unit_id = h.id AND s.is_deleted = 0 AND s.quantity > 0)
  AND h.id IN (2103023363906736130, 2103180080418263041, 2105452695115665410, 2105541960558317569,
               2105572583188598786, 2105663820000268289, 2105663826933452801, 2105663834940379138,
               2105663842146193409, 2105663849469448194, 2105663859351228417, 2105663867425263617,
               2105663878351425537, 2105663886635175937, 2105663895204139009, 2105663913529053185,
               2105663939714093058, 2105841282432765954, 2105875121683173378);

-- AFTER (expect 0 rows): re-run the first BEFORE query.
