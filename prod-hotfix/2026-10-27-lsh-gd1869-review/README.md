# 2026-10-27 LSH GD-2610-1869: stock call stopped after its balance write (same shape as GD-2610-1774)

**Status:** DONE on prod, verified 16:58.
- **What the user ran:** `release_locks.sql` (42's copy of the same statement, checked), then `retry.sql`.
- **Result:**
  - `|1` REJECTED (16:54:39), `|2` DONE OK (16:55:37), job COMPLETED (16:55:45).
  - GD-2610-1869 is Created, and no lock is held.
  - LSH BALANCE OK: no lost update, unlike 1774.

## What happened (128671, job 2115002387512037378, 16 batch allocations)
- **The stop:** op `GD|2115002387512037378|1` wrote its 32 planned rows (16 `item_batch_balance` + 16 `item_balance`) at 08:49:43 UTC. Its after-write check then found 2 rows OTHER.
- **The OTHER rows:** batch row 2113416277325385730 and its item total 2113416277442826242 both stood at their planned value minus 24. A classic phone delivery of 24 from Reserved had landed on top, consistently on both rows.
- **Result:** REQUIRES_REVIEW "AFTER_BALANCE_WRITE": 0 movements, 48 effects UNCERTAIN, 48 locks held. One more create waits behind it.
- **Rows at 16:51:**
  - 26 are exact.
  - 6 (3 batch / item pairs) carry later classic deliveries on top (-24, -4, -4), equal on each pair.
  - Undoing it sends no row below zero.

## Run on prod, in this order
1. **`release_locks.sql`:** preview 48, then the UPDATE (48 rows), then the check (0). This unblocks the waiting create.
2. **`retry.sql`** (`gen_retry.py` mode `after_balance_write`, attempt 1, built by `build_review_retry.py`, the same steps as 1774):
   - PART 1: every line must match.
   - PART 2: expect 16 / 16 / 1 / 48 / 1 / 1 / 1. 0a / 0b each change all rows or none.
   - PART 3: the checks.
3. **After:** the worker retries with `|2` and 1869 becomes Created. I then check the movements, the locks and LSH BALANCE. After 1774 a batch row had a lost update; here the pairs agree so far.
