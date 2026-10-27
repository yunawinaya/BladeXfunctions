# 2026-10-27 LSH GD-2610-1774: stock call stopped after its balance write

**Status:** DONE on prod, verified 16:02. One batch row still to correct (`fix_batch_706.sql`).
- **Locks released:** by the user at 15:50 (`release_locks.sql`, 90 rows). The 18 waiting GD creates moved on.
- **Retry:** `retry_1774.sql` was run by the user at about 15:58.
  - 15:58:58: the worker took the RETRY to `|3`.
  - 16:00:54: `|3` ended DONE OK, "90 effect(s) verified".
  - The job then COMPLETED, and GD-2610-1774 is Created.
  - `|3` wrote 60 movements (30 OUT Unrestricted / 30 IN Reserved, 235 each way). `|2` wrote none, and no lock is held.
- **Lost update, to correct with `fix_batch_706.sql`:**
  - prod_health BALANCE flagged batch 2113417298927816706 at bin 2079487564737286146: reserved 3 by movements against 4 in the balance.
  - At 15:15:35 the classic GD-2610-1713 delivered 1 unit from that batch's Reserved. The item total shows it (3 / 118).
  - `|2`'s planned write overwrote it on the batch row (4 / 59). The undo and retry were by delta, so they kept it.
  - The fix: this batch row -1 reserved / -1 balance, guarded on its exact current values.

## What happened (128671, job 2114978878563946498, 30 batch allocations)
- **Op `|1`:** REJECTED LOCK_CONFLICT (stale before mutation).
- **Op `|2`:** wrote its 60 planned balance rows (30 `item_batch_balance` + 30 `item_balance`: Reserved +470, Unrestricted -470) at 07:15:13 UTC.
- **Why it stopped:** its after-write check found one row not at the planned value.
  - That row is `item_balance` 2113417299326275585: reserved 3 / balance 118 against the planned 4 / 119.
  - A classic delivery of 1 unit from Reserved (LSH phones, which take no locks) had landed on top of its write.
  - The result was REQUIRES_REVIEW VERIFICATION_MISMATCH "AFTER_BALANCE_WRITE": no movements written, 90 effects UNCERTAIN, 90 locks held.
- **Rows at 15:48:** all 60 still carried `|2`'s change.
  - 42 were exact.
  - 18 carried later classic deliveries (-1 to -5) or a Block -> Unrestricted move of 836 on top.
  - Nothing was lost.
- **Knock-on:** GD-2610-1778 FAILED GD_INSUFFICIENT_STOCK on one batch row that 1774 holds. It is the younger delivery, so LSH converts its SO again.

## The repair (`gen_retry.py` mode `after_balance_write`, built by `build_1774.py` from `|2`'s own plan)
1. **Undo by delta (0a / 0b, one statement per table, all 30 rows or none):** take `|2`'s change back, `reserved_qty - k`, `unrestricted_qty + k` per row. Every later change on the rows is kept, and no row may go below zero.
2. **Retry steps (1-5), as for Kenhin 2168:**
   - Operation `|2`: REJECTED STALE_BEFORE_MUTATION with `mutation_started_at` cleared; the original message is kept at the end.
   - Effects: NOT_APPLIED.
   - Gate: REJECT.
   - P3 step: STARTED (attempt 2).
   - Job: COMMITTING_GD, due now. The job row is written last.
3. **Then the worker:**
   - GD_BULK_COMMIT takes its own RETRY to `|3` (job attempt_count 2).
   - `|3` re-reserves the same stock under its locks and writes the 60 movements. 1774 then becomes Created.
   - 1774 is the oldest delivery waiting for that stock, so younger ones wait for it ("older delivery goes first").

## Dev test (`scratchpad/gdc/retry_review/live_retry_after.py`, user's yes)
1. **Setup:** the twin SO/20260910-034 (10 x TES511) went through a real engine stop (`BEFORE_FIRST_WRITE`, plan stored), then into 1774's state:
   - the plan's change applied to its row;
   - the message set to AFTER_BALANCE_WRITE;
   - the locks released;
   - a fake classic delivery of 1 unit (Reserved -1, balance -1) added.
2. **Repair:** the preview matched, and the UPDATEs wrote 1 (undo) / 1 / 3 / 1 / 1 / 1 rows.
3. **The fake delivery's row:**
   - 39 before the repair, 29 after the undo, so only `|1`'s 10 came off.
   - 39 after the retry: `|2` re-reserved 10, and the -1 is still there.
4. **Retry:** the job COMPLETED as GD/20261027/642, with `|1` REJECTED and `|2` DONE OK.
5. **Against the normal twin (GD/20261027/640):** GD lines, reservations, SO, SO lines, balances and movements are the SAME. Only the conversion time and the same-day item date differ.

## Run on prod (`retry_1774.sql`)
1. **PART 1 (read-only):** every result must match the line above it, including undo "30 present, 0 below zero" for both tables.
2. **PART 2:** run one statement at a time. The expected counts are 30 / 30 / 1 / 90 / 1 / 1 / 1; if one differs, stop and send it to me.
   - 0a / 0b change all 30 rows or none.
   - A stop after 0a / 0b with the job not yet touched is safe: I can rebuild from there.
3. **PART 3:** the checks.
4. **After:** any LSH GD list or SO list follow starts the worker. Expect 1774 Created within a few minutes. I then check that `|3` is DONE with its 60 movements, that no lock is held, and that the balances agree with the movements.
