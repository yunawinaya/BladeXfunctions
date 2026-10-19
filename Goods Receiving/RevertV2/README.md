# GR Revert V2 — Revert Completed / Received in the background (dev only)

Built 2026-10-15. The GR list's Revert takes a completed or received receipt back to Created in the background, in
steps that each check what they wrote. On dev a 2,000-line receipt reverts in about 2.4 s (SUBMIT) plus 92 s (worker).
The classic GR_REVERT_COMPLETED makes one SUBTRACT call per movement and refuses at 500 lines. **Prod has none of
this.**

| Workflow (dev id, version) | Role |
|---|---|
| GR_REVERT_SUBMIT `2110563805617885185` v3 | runs GR_REVERT_COMPLETED's checks (`grRvPrep`, lifted; same texts) on the stored receipt. Then it writes the LOCK row, queues a `REVERT_GR` job and sets the receipt to `Processing`. `operation: STATUS` reports the job of a key, or the receipt's latest one |
| GR_REVERT_WORKER `2110563842980745217` v3 | claims due jobs and calls PREPARE, then COMMIT twice (COMMIT splits after the stock step) |
| GR_REVERT_PREPARE `2110563883002793986` v3 | the classic's reads as SQL with no row caps, then `grRvPrep` + `grRvBuild` (lifted). Every conflict the classic refuses with (409, same texts) fails the job with that list, before anything is written. Otherwise it produces the plan: SUBTRACT `GRN-R` movements at the receipt's own price, from where the receipt's stock sits now |
| GR_REVERT_COMMIT `2110563921229680642` v6 | R0 PO locks `GRPO\|<po>` + revalidation on fresh rows · R1 stock (INVENTORY_BULK_APPLY, all or nothing) · R2 costing rows (FIFO layers, Weighted Average rows deleted / restated) under the COST locks · R3 TOs, in-transit rows, QI lots, split batches · R4 PO lines, on-order, PO headers · R5 the receipt (Created) |

Built from `scratchpad/grrv/` (`python3 build_grrv.py [--write] [NAME ...]`; design in `GRRV_DESIGN.md`). Published
with `.dbtools/wf_upload.mjs`. Uses the same job tables, lock rows and PO locks as GR Completion V2, so a revert and a
completion of the same PO never run at the same time.

## What goes to the background

Every receipt the classic can revert, up to 2,500 lines. Run by the classic GR_REVERT_COMPLETED instead (at most 500
lines; above that the list says why):
- a handling unit anywhere in the receipt's chain;
- a serial-numbered item.

The list's own checks (invoiced, returned, posted to accounting, putaway In Progress) still run first, unchanged.

## Client (published to dev 2026-10-15: GR list page v211)

**GR list page** — `Bulk Actions/Procurement/Goods Receiving/GRlistPageJSON.json`:
- `RevertCompletedGR` becomes `grv_list_RevertCompletedGR.js`. It sends one SUBMIT per selected receipt, then starts
  the worker and keeps it going while it finds work.
- `mounted` gets `grv_list_mounted_kick.js` added (next to the GR Completion kick).

After each worker tick the list asks the receipts it queued for their job's status. A refusal the background found
(e.g. "Revert blocked: … has been used since this receipt") is shown in a "Revert did not finish" alert, as the classic
showed it at once. If the list was closed first, the receipt simply shows Completed again; Revert again to see why.

Switch: `ASYNC_REVERT_ENABLED` at the top of the handler (`false` = classic for every receipt).

## Deliberate differences from the classic revert

- Stock is all or nothing. The classic can stop part way through ("Revert stopped part way through").
- Weighted Average rows are restated once, from every row of the receipt. The classic restates after each row, so a
  retry under-reverses non-batch items.
- PO lines and headers are recomputed from fresh reads under the PO lock, not from the copy read at the start.
- No fetch caps: the classic refuses big receipts with `fetch_truncated`.
- R2 writes the plant-level FIFO / Weighted Average rows itself (R1's `GRN-R` movements are category moves and take no
  COST key). Since v6 (dev 2026-10-16) it first takes `COST|<material>|<plant>` for every item it restores, the same
  lock rows INVENTORY_BULK_APPLY v8+ takes, as operation `GRV|<job>|R2`. Keys are sorted and seeded when missing; a
  key another job holds means a 5 s wait that does not count as a retry. The locks are given back on every R2 exit and
  after R2 DONE, then read back; a lock still held makes the job retry with backoff before it moves on to R3. The
  classic revert takes no lock, like every classic posting.

## Tested on dev (tenant 711077, 2026-10-15)

| Test | Result |
|---|---|
| 2,000-line round trip: PO/20261015/008 → GR/202610150007 Completed (V2) → Revert V2 | SUBMIT 2.4 s, worker 92 s, COMPLETED. PO lines, on-order, balances and PO header back field-identical; 1,999 FIFO layers deleted; 2,000 unique `GRN-R` keys |
| GR/202610150006, whose stock a later delivery had used | FAILED cleanly in PREPARE with GRV_STALE: the classic's "used since this receipt" rule, 159 items listed, nothing written |
| GR/202610160014 (tenant 000000, 2026-10-16), COMMIT v6 | COMPLETED in one worker kick (2 s). Both COST rows seeded, taken (TAKEN 2/2), held about 130 ms over R2, then given back (GIVEN 2/2): `free_token` 1, last owner `GRV\|<job>\|R2`, `lock_version` 1. The receipt's 2 FIFO layers removed, 2 `GRN-R` movements |
| Offline | plan core parity on 512 recorded receipts (0 errors), 57 unit; `test_commit` 91 (20 for the COST lock); list handler `scratchpad/grv2/switchon/test_handlers.js` (45 with the GR form) |
