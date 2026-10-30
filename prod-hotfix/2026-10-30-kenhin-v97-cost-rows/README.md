# 2026-10-30 Kenhin: V97's FIFO-only cost rows block GD/20261030/2341

**Status:** RUN on prod 10-30 11:49:28, verified: WA row 2116017246831546368 = 1000999970.00000000 at 51.94805345, both FIFO
rows `is_deleted = 1`. Before the run (read-only): PART 1 = 2 / 0 / 0, the insert would add 1 row, the update matched the 2
FIFO rows only once the WA row existed; both statements parsed (EXPLAIN on dev). Next: Kenhin completes the GD again.
**MISTAKE:** the cost went in with 8 decimals; Kenhin's price rule keeps 4. The 11:50 completion's stock step re-wrote the row,
the platform stored 51.9481, the read-back expected 51.94805345 and the job went to review: `../2026-10-30-kenhin-gd2341-review/`.
The row now holds 51.9481 (stable). build.py must round to the tenant's `su_code_num_precision` rule before any reuse.

## What happened
- GD/20261030/2341 (V97 12, S01-01 12, BM04-10 120): the Picking completed and handed the GD to GD Completed V2 at
  11:22:52. V2 refused it at 11:23:05: `GDC_INVENTORY_UNSUPPORTED_COSTING` "Item 2058889562500812805 has costing rows that
  need migration (FIFO 2, WA 0)". Nothing was written; the GD is back to Created, its Picking stays Completed.
- V97 (LENGKUAS [GALANGAL] [4.5-5KG]) is Weighted Average, but its only cost rows are two FIFO layers: 999,971 at RM 0
  (2026-05-26 opening load) and 999,999,999 at RM 52 (MSR-20260924-0007). The stock engine refuses such items; classic
  SUBTRACT_INVENTORY_NEW (prod v25) migrates them itself ("Migrate Costing Incorrect Data"), V2 does not.
- V97 was left out of `../2026-10-28-kenhin-wa-cost-rows/` for that RM 52 layer. User, 10-30: migrate it as classic would.
- Also reserving V97, not picked yet: GD/20260820/291, 0827/433, 0903/458, 0917/855, 20261001/1299 (17 units).

## The fix (`migrate.sql`, built by `build.py`)
- One `wa_costing_method` row: 1,000,999,970 at RM 51.94805345 (classic's q8 weighted cost; RM 51.9481 at 4 dp).
- Both FIFO rows: `is_deleted = 1`.
- V97 then costs ~RM 51.95 a unit (it was 0): this GD's 12 = RM 623.38.
- Both statements act only while the FIFO rows still hold 999,971 / 999,999,999 and no WA row exists, so a second run does
  nothing.

## Run, in order
1. **PART 1:** expect 2 / 0 / 0.
2. **PART 2:** expect rows affected 1 (insert), then 2 (update).
3. **PART 3:** expect the WA row `2116017246831546368 1000999970.00000000 51.94805345`, and 0 FIFO rows still active.
4. **Then Complete GD/20261030/2341 again** (GD list -> Complete, or the GD form's Completed). V2 completes it.

**Rollback:** `rollback.sql`, only before any delivery uses the new WA row.
