-- R5  BUG-011  Packed HUs claimed by a Completed Packing that no longer lists them (LSH, 128671)
-- ---------------------------------------------------------------------------------------------
-- REPORT ONLY -- needs your decision per Packing, no write is drafted.
--
-- 22 HUs hold goods (item_count > 0, status Packed) and carry packing_id of a Completed Packing,
-- but that Packing's table_hu (packing_hr4nq20g_sub) has no row for them. PACK-20261002-0228 is
-- the confirmed case: two devices saved Completed 26 s apart and the second replaced 5 HU rows
-- with its own 2 (runs 2105921110972436482 / 2105921218866712578). After PACKING_SAVE is
-- deployed, a Completed save on an already-Completed Packing keeps the stored rows instead.
--
-- Clearing packing_id would be WRONG: these HUs physically contain that Packing's goods, so
-- releasing them would let another Packing pick them up. The faithful repair is to restore the
-- missing table_hu rows from the earlier Completed-save payload of each Packing (which recorded
-- them, with temp_data). That needs platform-shaped subform rows, so it is not hand-written here:
-- confirm which Packings matter (printouts, SI posting) and the rows can be generated per Packing
-- from those recorded payloads and reviewed before running.
-- ---------------------------------------------------------------------------------------------

SELECT p.packing_no, p.packing_status, h.handling_no, h.id AS hu_id, h.hu_status, h.item_count
FROM handling_unit h
JOIN packing p ON p.id = h.packing_id AND p.is_deleted = 0
WHERE h.tenant_id = '128671' AND h.is_deleted = 0
  AND h.packing_id IS NOT NULL AND h.packing_id <> ''
  AND p.packing_status = 'Completed'
  AND NOT EXISTS (SELECT 1 FROM packing_hr4nq20g_sub r
                  WHERE r.packing_id = p.id AND r.is_deleted = 0 AND r.handling_unit_id = h.id)
ORDER BY p.packing_no, h.handling_no;
