# 2026-10-30 Kenhin GD/20261030/2341: completion stopped for review after the V97 repair

**Status:** RUN by the user 10-30 ~12:20, verified: the job COMPLETED on attempt 1 (IBA|RUN|002 -> IBA|DONE), GD/20261030/2341
Completed 12:20:36 with SI/20261030/1098, 0 locks held, 3 movements (no duplicate), reservations Delivered (open 0), V97's WA
row unchanged (1,000,999,958 at 51.9481).

## What happened
- 11:49:28 the V97 repair (`../2026-10-30-kenhin-v97-cost-rows/`) inserted V97's WA row at **51.94805345** (8 decimals, classic's
  in-memory q8 value). Kenhin's price rule keeps 4 decimals, so a platform write stores 51.9481 (classic's migration writes
  through the platform, so it would have stored 51.9481 from the start).
- 11:50:13 Kenhin completed the GD again (COMPLETE_GD 2116014785236701185). C0 / C1 done; C2's INVENTORY_BULK_APPLY
  (operation GDC|2116014785236701185) wrote the 3 balances, 2 FIFO rows, the WA row and the 3 movements; the platform stored
  the WA cost as 51.9481; the read-back expected 51.94805345 -> 500 REQUIRES_REVIEW -> job REQUIRES_REVIEW
  (GDC_RECONCILIATION_MISMATCH, "the completion stopped half-way"), GD Processing.
- The run kept its 6 locks: COST + ITEM|bin 501 of S01-01, V97, BM04-10.
- Read-only 12:2x: every planned row equals its planned value except that cost; nothing else touched them.

## The fix (`resume.sql`)
- The engine's stored plan (IBA|I|001) takes the stored cost (its before and after values).
- The engine's IBA|REVIEW row: `is_deleted = 1` (IBops reads `is_deleted = 0` only).
- The job: COMMITTING_GD with an ended lease, as GD-2610-1473 on 10-26 (`../2026-10-26-gd1473-dead-lease/`).
- The next GD_COMPLETE_WORKER tick re-claims it, the engine resumes (nothing left to write, read-back passes, IBA|DONE), and
  the completion carries on and releases the locks.

## Lesson
A repair SQL must store every decimal the way the platform would: at the tenant's rule in `su_code_num_precision` (Inventory
Price / Inventory Qty, or a column rule). The engine re-writes unchanged columns and checks them back exactly.
