# Location Transfer V2 (background saves for big transfers)

Location Transfers over **50 lines**, saved from the web form, run as a background job through the shared inventory engine
(INVENTORY_BULK_APPLY) instead of the classic `SM_LOCATION_TRANSFER`. That classic save costs about 1 s per stock row and
cannot handle 2,000 lines.

Smaller transfers, all mobile saves, and anything not eligible keep using the classic save, which now has a guard (see below).
The design and every interface are in `scratchpad/smv2/CONTRACT.md`; the builder and its tooling live in `scratchpad/smv2/`.

## Workflows (dev ids; same in prod after a full deployment)

| Workflow | id | Role |
|---|---|---|
| LOT_V2_SUBMIT | 2110992282596540417 | Synchronous. Decides the action from the STORED status. Writes the document, job and lock rows idempotently. Answers SUBMIT / STATUS. |
| LOT_V2_WORKER | 2110992316335521793 | Claims due `SAVE_LOT` jobs and runs PREPARE, then COMMIT phase A, then phase B. Above 1,000 lines the job PARKs after phase A and the next kick runs phase B. |
| LOT_V2_PREPARE | 2110992359150977026 | Runs the classic v82 compute code, lifted verbatim, on SQL reads. Writes the manifest: ENGINE / LABELS / IT / HDR / ITEMS parts. |
| LOT_V2_COMMIT | 2110992400045441026 | L0 revalidate → L1 one engine APPLY (all-or-nothing) → L2 lines (COMPLETE / EDIT) → L3 In Transit ledger → L4 header, Item date and unlock. |
| SM_LOCATION_TRANSFER | 2013133675374927874 | The classic save: deployed v82 plus guard nodes (`SM_LOCATION_TRANSFER.json`). |

Repo files: `LOT_V2_*.json`, `SM_LOCATION_TRANSFER.json` (guarded classic), `LOTform.json` (dev form v107 + V2),
`LOTlistPage.json` (list page v48 + V2), and the handler mirrors `lotV2_onClick_save_{draft,inprogress,completed}.js`,
`lotV2_mounted.js`, `lotV2_list_mounted_kick.js`. List Cancel: `Bulk Actions/Warehouse Management/Location Transfer/Cancel.js`.

**The repo's `../LOTsaveWorkflow.json` and `../LOTfullJSON.json` are NOT the deployed versions.** They hold an unreleased
Stock Picking branch and lack the bundle and q8 work, so never deploy them.

## Actions

| Action | From → to | Stock | Ledger (`in_transit_detail`) |
|---|---|---|---|
| DRAFT | Add/Draft → Draft | none | none |
| DIRECT | Add/Draft → Completed | −C@source, +C@target | none |
| STAGE | Add/Draft → In Progress | −C@source, +In Transit@target | rows created |
| COMPLETE | In Progress → Completed | reconcile edits, then −In Transit@target, +C@target | rows closed (Received) |
| EDIT | In Progress → In Progress | per-line deltas; a target-bin change moves the In Transit stock | rows created / adjusted |
| CANCEL | In Progress → Cancelled (list) | −In Transit@target, +C@source | rows Cancelled; number gets "-Cancelled" |

**Not eligible for V2** (they go to the classic save; above 500 lines they stop with the reason):
- HU entries
- bundle lines
- rows that need auto-allocation
- serial items
- production-order-linked transfers
- items whose costing rows need migration
- categories other than Unrestricted / Blocked
- more than 2,500 rows or 5,000 engine movements

A Draft is never refused: anything not eligible goes to the classic Draft save, which has no size cap.

## Switches (client constants; there is no server-side switch)
Each switch is a constant inside a page's event handler, and every copy must be set:

| Where | Handler | Constants |
|---|---|---|
| `LOTform.json` (the form) | `lotV2_onClick_save_draft` (Save as Draft) | `ASYNC_LOT_ENABLED`, `LOT_V2_ACTIONS`, `V2_MIN_LINES` |
| `LOTform.json` (the form) | `lotV2_onClick_save_inprogress` (Save as In Progress) | `ASYNC_LOT_ENABLED`, `LOT_V2_ACTIONS`, `V2_MIN_LINES` |
| `LOTform.json` (the form) | `lotV2_onClick_save_completed` (Save as Completed) | `ASYNC_LOT_ENABLED`, `LOT_V2_ACTIONS`, `V2_MIN_LINES` |
| `LOTlistPage.json` (the list) | `bulkCancel_LOT` (= `Bulk Actions/Warehouse Management/Location Transfer/Cancel.js`) | `ASYNC_LOT_ENABLED`, `LOT_V2_CANCEL`, `V2_MIN_LINES` |

- `ASYNC_LOT_ENABLED = true`: the master switch.
- `LOT_V2_ACTIONS = { DIRECT, STAGE, COMPLETE, CANCEL, EDIT, COMPLETE_EDITED, DRAFT }`: per-action switches (all `true`). Its
  `CANCEL` entry is not read; the list's `LOT_V2_CANCEL` decides Cancel.
- `V2_MIN_LINES = 50`: transfers with this many lines or fewer stay classic. The form counts its lines; the list sends it
  to SUBMIT as `min_lines`, which compares it with the stored line count. Set it to 0 to send every eligible transfer to V2.
- `LOT_V2_CANCEL = true`: the list's Cancel route.

The form's `mounted` and the list's `mounted` have no switch. They only follow jobs that already exist.

Turning a switch off sends that action to the classic save; nothing else changes. Source:
`scratchpad/smv2/client/src/`. Rebuild with `python3 scratchpad/smv2/client/build_client.py --write`.
**Turning V2 off (e.g. in prod) means editing and republishing BOTH pages:** the form (all three save handlers) and the
list page (`bulkCancel_LOT`). With only one of them changed, the other still sends saves or cancels to V2.

## Job conventions (shared tables, used unchanged)
- `gd_async_job`:
  - `command SAVE_LOT`
  - `correlation_id LOT|<lotId>`
  - `causation_id <lotId>`
  - `gd_id` / `gd_no` stay EMPTY, so GD_JOB_RECONCILE's gap scan ignores these jobs
- Document lock: header `stock_movement_status = 'Processing'` plus `gd_publish_step` `SMLT|<lotId>` / `LOCK|<n>`.
- Engine operation: `SMLT|<jobId>`.
- Ledger `job_line_key`: `<jobId>|<lineId>|<n>`.
- States: QUEUED → VALIDATING → READY_TO_COMMIT → COMMITTING_LOT → COMPLETED / FAILED / REQUIRES_REVIEW.
- No Quartz schedule:
  - the form kicks the worker after SUBMIT and re-kicks every 15 s from the Processing view;
  - the list kicks it on mount (throttled to every 2 min).

  A job nobody kicks stays queued. Opening the transfer or the list moves it on.

## The guarded classic save
New first nodes in `SM_LOCATION_TRANSFER`, before anything else runs:
- If `allData.id` is a stored id, one SQL read returns the **stored** status and line count. A stored `Processing` transfer gets 400 "This Location Transfer is being processed in the background - please wait for it to finish." Mobile sends "In Progress" for such a transfer, so the guard never trusts the payload.
- More than 500 lines on a non-Draft save gets 400. For Cancel, whose payload has no lines, the stored lines are counted.
- A stored In Progress transfer saved as Draft gets 400 (it would strand its In Transit stock).
- Bundle parent = `item_bundle_id` set, no `parent_fm_key` and no real `parent_id` (v85). Stored children carry only `parent_id`, so
  before v85 a classic Cancel of a bundle transfer returned only some of the children's stock.
- It reads only `sm_location_transfer`, never the job tables.

## Error codes
See `scratchpad/smv2/CONTRACT.md` section 10. In short:
- **FAILED** jobs restore the previous status. A failed Add or Draft leaves a Draft holding every line. Nothing moved.
- **REQUIRES_REVIEW** means the save stopped after stock moved, or the status to restore is unknown.

## Runbook: a job in REQUIRES_REVIEW
**Why it matters.** The engine keeps an operation's balance locks until it is DONE, including through review. A LOT stuck in
review blocks GD / GR / Putaway V2 saves on the same items.

**Lock scope (engine v8 onwards):**
- Every LOT V2 movement is `isMovingInv 1`, so a LOT op takes only bin-level keys: `ITEM|<mat>|<bin>` and `BATCH|<mat>|<bin>|<batch>`. A stuck LOT op blocks those item + bin (+ batch) combinations only.
- Callers that write cost rows (`isMovingInv 0`, e.g. GD / GR / Stock Adjustment V2) also take a plant-wide `COST|<material>|<plant>` key. A stuck op of theirs blocks that item in every bin of the plant. LOT V2 never takes or waits on COST keys.

Evidence: `scratchpad/sav2/race/EVIDENCE.md`.

1. Find the job:
   ```sql
   SELECT id, job_status, error_code, error_message, progress_message
   FROM gd_async_job
   WHERE command = 'SAVE_LOT' AND correlation_id = 'LOT|<lotId>'
   ```
   Then list its steps: `gd_publish_step` rows with `job_id = '<jobId>'` (`<STEP> DONE` rows), and the engine's rows with
   `job_id = 'SMLT|<jobId>'` (`IBA|I|…`, `IBA|DONE`, `IBA|REVIEW`).
2. **If `IBA|REVIEW` exists:** the engine's read-back did not match. Compare the balances against the engine's intent rows; fix the
   data, delete the `IBA|REVIEW` row, set the job back to `COMMITTING_LOT` with `attempt_count = 0`,
   `lease_owner = NULL`, `next_attempt_at = NOW()`, then kick `LOT_V2_WORKER {job_id}`. The engine RESUMEs, skipping rows already
   at their after-value. This is what was done for the GR V2 job on 2026-10-15.
3. **If the engine is DONE but a later step (L2–L4) stopped:** every step is re-runnable. Reset the job as above and kick the worker;
   a step whose rows are already at their after-value writes nothing.
4. **Dev:** writes go through `.dbtools/dbw` (preview, then `--execute`, with a yes). **Prod:** access is SELECT-only, so the repair goes through the platform.

**Don't run GD_JOB_RECONCILE on SAVE_LOT jobs.** Its DEAD_PRE and REVIEW branches match any command.

## Prod prerequisites: the V2 foundation (none of it is in prod as of 2026-10-16; no V2 module has gone to prod yet)

LOT V2 needs all of the following in prod. If any piece is missing, web Location Transfers over 50 lines fail instead of using the
classic save, so keep `ASYNC_LOT_ENABLED` false in prod (in the form AND the list: see Switches) until every row below checks out.

| Piece | Dev reference | Prod check (SELECT) |
|---|---|---|
| table `gd_async_job` (2104845286495150081) | UNIQUE `Idempotency Key` (tenant_id, organization_id, idempotency_key); also Worker Poll, Lease Recovery, GD Lookup | `information_schema.statistics` has the UNIQUE key |
| table `gd_publish_step` (2105131615547461634) | UNIQUE `Job Step` (tenant_id, job_id, step_name); job_id / step_name varchar(32) | UNIQUE key present |
| table `inventory_balance_lock` | UNIQUE `Lock Key` (tenant_id, organization_id, lock_key); also Lock Owner, Stale Lock, Taken Token | UNIQUE key present |
| column `inventory_movement.operation_effect_key` | present on dev | column present. Recommended: an index on (tenant_id, operation_effect_key). The engine reads it twice per APPLY; prod has about 319k rows and only a PRIMARY index |
| column `in_transit_detail.job_line_key` | varchar(255) on dev | column present |
| workflows INVENTORY_BULK_APPLY (2109916822821744641, dev v7) + INVENTORY_LOCK_TOKENS (2105936479113383937, dev v4) | they ship together | enabled versions = dev |
| LOT_V2_SUBMIT / _WORKER / _PREPARE / _COMMIT, the guarded SM_LOCATION_TRANSFER, LOT form v108 (columns `lot_v2_job_id`, `lot_idem_key`), list v48 | this folder | enabled = dev; LOT columns present |

The UNIQUE keys are load-bearing: idempotency, the worker's claim gate, and the engine's lock keys. A table that is copied without
them would let duplicate jobs or claims through. Prod's largest Location Transfer so far is 44 lines, so V2 will rarely run
there at first.

## Known gaps / risks
**Live-tested on dev** (`.superpowers/sdd/gd-picking-packing-gr-fluffy-bentley/live-report.md`):
- 10-16: every action at small size, including COMPLETE with edits (the fold), EDIT, CANCEL, the FAILED path and lock contention.
- 10-19: a 1,458-line bundle DIRECT (PARK), and one-bundle STAGE → COMPLETE.
- 10-20: a classic bundle cancel, and a bundle qty raise on EDIT (51 lines).
- 10-21: 1,050 lines STAGE → COMPLETE → restore. L3 wrote 5 slices of up to 250; COMPLETE carried 5 S parts; each step PARKed once.
  On the slowed dev each engine APPLY took 176–345 s (prod is ~6× faster).

**Not live-tested:** costed-item pricing (engine parity covers it), the L0 changed-lines / changed-ledger refusals, REQUIRES_REVIEW
recovery, and the client JS handlers (the BA's browser pass).

**Behaviour to know about:**
- A crash inside L2's single platform call → REQUIRES_REVIEW.
- Lock waits count toward `attempt_count`, so a crash after 3 waits → REQUIRES_REVIEW.
- An engine 409 waits up to 8 times (15 s × 2^n, max 5 min, ~23 min in all). Without this operation's intent rows it then FAILs
  cleanly; with them (an earlier run may have written; engine v12 answers 409 for up to 20 min after such a run dies) it goes to
  REQUIRES_REVIEW, never a clean FAILED (COMMIT v8, 2026-10-21).
- Engine parity on 1,872 recorded prod LOT pairs: no differences in stock or cost. 134 differ cosmetically (remark NULL vs '', date-only columns).
- The engine copies batch dates from the SUBTRACT side (`unit_price_from`); this has never differed in recorded data.
- Classic bugs FIXED in v84 (dev 2026-10-16): the guard refuses saving a stored In Progress transfer as Draft (400), and
  `code_node_OHjnEcVJ` loops `subFormData` with a numeric compare (production-order-linked edits no longer throw).
