# GD Cancel V2 on Pickings shared by several deliveries (2026-10-25, refreshed 14:10)

## What went wrong

LSH cancelled GD-2610-1302 to 1311 together. Their Pickings serve several deliveries each. A Picking header's `delivery_no` lists
them all, for example `GD-2610-1305, GD-2610-1311`.

Step **X5_NUMBERS** renames the cancelled GD's number in that list. It compared the WHOLE text with the before / after it had
saved in PREPARE. The cancels that ran first renamed their own numbers in the same text (`GD-2610-1311-Cancelled`). So 1305,
1308 and 1310 found the text "changed by someone else" and stopped for review. Their GDs are left in Processing after X0-X4:
stock released, reservations cancelled, sales orders updated.

The same pattern sat in **X4P_PICKING** for open Pickings: the header status came from PREPARE's snapshot and was checked as a
whole row. Concurrent cancels would go to review, or leave a Picking open with every row Cancelled.

The BA's analysis (LSH-GD-Investigation-20261025) found the same and was checked against prod.

Found on the way (dev live test): the cancel's Picking and Packing reads get slower with the tenant's Picking / Packing volume, by
the square of its rows. They hit the 30 s statement limit on dev. On prod, LSH's 2,100 Packing lines already cost 2.5 s alone and
7 s with 10 cancels at once (10:13 today), and tomorrow adds lines.

## Fix (builder `scratchpad/gdcan/`)

- **GD_CANCEL_COMMIT, X5:**
  - A Picking header renames only this GD's token, in the text as it is NOW. Other GDs' tokens are kept.
  - Done means the new token is there and the old one is gone. A review happens only when neither is in the list.
  - The read-back checks only this GD's token. If a sibling's write lost it, the step retries and renames again, instead of
    going to review.
  - Single-number columns (Picking rows, Packing header / lines) keep the before / after check.
- **GD_CANCEL_COMMIT, X4P:**
  - Each Picking header is decided on its rows as they are now (a new read of every row of the Pickings), using PREPARE's rule:
    Cancelled + `-Cancelled` once every row is Cancelled (the suffix added once), Completed once nothing is left to pick.
  - A Cancelled header is left alone. A Completed one too, unless this GD has rows on it: then a sibling cancel closed it
    Completed meanwhile, and it becomes Cancelled once every row is Cancelled (the first dev live test left it Completed).
  - The read-back recomputes the same way, so whichever concurrent cancel checks last closes the header.
- **GD_CANCEL_COMMIT, X4P and X5:** a Picking held by another job (GD Edit V2 or a confirm: is_processing 1, lock under 15 min)
  is not written; the step waits (a counted retry). Agreed with the GD Edit & Picking session.
- **GD_CANCEL_WORKER:** budget 20 -> 240 s, as for GD_COMPLETE_WORKER, so one kick runs up to 5 cancels.
- **GD_CANCEL_PREPARE and GD_CANCEL_SUBMIT:** the Picking / Packing / box reads read each id set once (a derived table) instead
  of once per row. The rows returned are the same.

## Evidence

- `scratchpad/gdcan/test/test_shared_picking.js`: 26 cases on the built COMMIT, all pass (9 fail on the old build), including
  the exact LSH case and the sequence of the first dev live test.
- Commit simulation: all scenarios pass. PREPARE / SUBMIT simulation: 21 pass. Lint: unchanged.
- The new reads gave identical rows to the old ones on 8 LSH GDs (prod, read-only) and 3 dev GDs:
  - Packing read 2.5 s -> 0.4 s;
  - box read 1.7 s -> 0.4 s;
  - dev Picking read over 30 s -> 0.3 s.
- Dev live tests:
  - 13:23, 000000 PI-20261019-0361 (v7): both cancels COMPLETED with no review, numbers renamed, rows Cancelled. The header
    ended Completed; fixed in v8.
  - 14:02, 496474 PI-20261021-0104 (v8 + reads): both COMPLETED. Header Cancelled with one suffix, delivery list
    `GD/20261021/112-Cancelled, GD/20261021/113-Cancelled`, all 4 rows Cancelled, all 5 reservations Cancelled.
    This run took the other order, so the Completed → Cancelled header path is proven offline only (its exact live sequence is
    a test case).
- Dev: GD_CANCEL_COMMIT v8, GD_CANCEL_WORKER v5, GD_CANCEL_PREPARE v4, GD_CANCEL_SUBMIT v4, all IDENTICAL to these files.

## Prod, in this order

Each file is prod's live version plus exactly the nodes named. After each paste: `.dbtools/wf --prod deployed <file>` must say
IDENTICAL. Do not mix up the four GD_CANCEL_* workflows, or GD_CANCEL_WORKER with GD_COMPLETE_WORKER.

1. `GD_CANCEL_COMMIT.prod_v5_shared_picking.json` → **GD_CANCEL_COMMIT** (id 2112455779051212802). 10 nodes: X4P ids / plan /
   check and its 2 queries, X5 ids / plan / check and its 2 queries.
2. `GD_CANCEL_WORKER.prod_v4_budget240.json` → **GD_CANCEL_WORKER** (id 2112455700319932418). 5 nodes (the budget constant).
3. `GD_CANCEL_PREPARE.prod_v3_fast_reads.json` → **GD_CANCEL_PREPARE** (id 2112455739305988098). 3 read nodes.
4. `GD_CANCEL_SUBMIT.prod_v3_fast_reads.json` → **GD_CANCEL_SUBMIT** (id 2112455664139866113). 2 read nodes.
5. Run `resume_3_cancels.sql` (expect 3 rows). The jobs continue from X5; X0-X4 are not repeated.
6. Open the LSH GD list once. Its mount kicks GD_CANCEL_WORKER, which resumes all three.

Steps 1-4 are independent of each other, so any order works. COMMIT goes first because it closes the review risk for any cancel
LSH starts meanwhile.

`*_live.json` files are what prod runs now (COMMIT v5, WORKER v4, PREPARE v3, SUBMIT v3), kept only to reverse the change.
