# Picking confirmation, background save (V2) — dev only, stages 1a + 1b + 1c (+ 1d Force Complete, built)

Stage 1a (normal Goods Delivery pickings) built 2026-10-12, deployed on dev 2026-10-12. Stage 1b
(**Full Picking**) built 2026-10-13. Stage 1c (**Loading Bay** and **bin / batch swaps**: picks that
move stock) built, deployed and live-tested on dev 2026-10-16. It replaces the synchronous Save as
Completed of the Picking form, and the list's **Auto Pick & Complete**. Before this, a 2,000-line
Picking re-saved the whole GD through `GOODS_DELIVERY` on every confirmation and took the dev server
down on 2026-10-09.

The four workflows here are generated from tested code. **From now on, edit the JSON in this
folder directly**, the same way `Goods Delivery/AsyncV2/` is maintained.

## The flow

```
Picking form "Completed" ──► PICKING_ASYNC_SUBMIT ──► gd_async_job (command CONFIRM_PICKING, QUEUED)
list "Auto Pick & Complete"     (NOT_ELIGIBLE → the old       Picking is_processing = 1    dialog closes
                                 onSave_Completed / old
                                 fill-and-save path)
      └─ kick ──► PICKING_ASYNC_WORKER (also a Quartz row) ── claim W0_CLAIM_<row_version> + 10-min lease
                    ├─► PICKING_BULK_PREPARE   VALIDATING → READY_TO_COMMIT (prepared_payload) or FAILED (+ unlock)
                    │     a pick that moves stock (1c): GD_REPLAN per moved GD → INVENTORY_BULK_APPLY PLAN
                    └─► PICKING_BULK_COMMIT    run A: P0 revalidate → [PM1 stock → PM2 reservations → PM3 GD
                                               allocation, 1c] → P1 Picking → P3 GD lines → P4 GD headers → SPLIT
                        PICKING_BULK_COMMIT    run B: P5 Packing, 25 GDs per chunk (if Completed + auto packing) → P6 unlock, COMPLETED
mobile app ──► PICKING_LOOP ──► PICKING (unchanged, with the size guard from 2026-10-12)
```

**It never re-saves the Goods Delivery.**

- A normal pick changes only:
  - the GD lines' `picking_status` and `prev_temp_qty_data`;
  - the GD header's `picking_status`.
- These are written directly, using the old rules:
  - lines: `code_node_iES7iMKA`;
  - header: B3E0 plus `rollUpPicking`.
- A Full Picking pick also writes the GD lines' `picked_qty`, `picked_temp_qty_data` and
  `picked_view_stock`, recounted from every Picking's records as `code_node_MNRecompute` does.
- A pick that moves stock (1c) runs what `GOODS_DELIVERY`'s "Save as Created from PICKING" would do,
  in-process (`GD_REPLAN`, on GD Edit V2's lifted code), and writes only its result: the stock
  (INVENTORY_BULK_APPLY, operation `PKM|<job>`), the reservations, and the moved lines' allocation.

## What goes to the background and what does not

The form and SUBMIT send a case to the **old save** (`NOT_ELIGIBLE`) when it is:

| Case | Old save, because | Stage that adds it |
|---|---|---|
| A new Picking (Add), a Draft, mobile / split data | not a stored confirmation | — |
| Picking Setup: picks after **Sales Order** (Picking Plan) | not ported yet | 1f |
| **Auto Complete GD** | the GD completion must be async too | 1e |
| List **Force Complete** | V2 built (stage 1d, below): `STAGE.FORCE_COMPLETE` is off until its live twins | 1d |
| A move (1c) with: Full Picking on, a handling unit on the moved line, a serial-numbered item or select picking on the moved GD, internal-trading linkage | not ported | — |

Since 1c, a line picked into another bin or batch (both sides set and different, classic's test)
and every **Loading Bay** confirmation (the Picking Setup flag, as classic) go to the background.
SUBMIT refuses, with classic's text where classic has one: Loading Bay with Auto Complete GD; a
Loading Bay line without a target bin (or the source bin); more than 25 moved GDs or 500 moved-GD
lines in one confirmation (classic refuses a move on a GD above 500 lines); a moved GD that another
Picking is confirming. PREPARE repeats every
refusal (the GDs may change in between).

Switches:

- `STAGE` and `ASYNC_PICKING_ENABLED` at the top of `code_node_PSdecide` (SUBMIT).
  `STAGE.FULL_PICKING` is on since stage 1b; `STAGE.LOADING_BAY` / `STAGE.BIN_MOVES` since the 1c
  live tests (2026-10-16).
- SUBMIT stamps `moves: 1|0` on the job (whether these switches cleared it). PREPARE refuses a move
  or Loading Bay on a job without it, with 1b's texts: a target saved after SUBMIT, or a job queued
  by an older SUBMIT, never moves stock. Turning the two switches off restores 1b exactly.
- `ASYNC_PICKING_ENABLED` in both client handlers.

Picking Setup and Packing Setup are read exactly as PICKING reads them: **the organization's first
row** (lowest id), not the Picking's plant. Some organizations have one row per plant.

## Job model (shared `gd_async_job` / `gd_publish_step`; the GD worker polls only `CREATE_GD_FROM_FORM`)

**Job states:**

- Normal path: QUEUED → VALIDATING → READY_TO_COMMIT → COMMITTING_PICKING → COMPLETED.
- Terminal: FAILED or REQUIRES_REVIEW.

**SUBMIT:**

- Creates the job, or returns the existing one, by `(tenant, organization, idempotency_key)`. The
  key is one per click; a retry of the same click reuses it.
- Refuses while another job of the Picking is open or under review.
- Refuses while the old path holds `is_processing` (unless the lock is older than 900 s).

**PREPARE:**

- Reads everything set-based from the stored Picking: lines, GD lines and item units.
- Ports PICKING's rules:
  - records and the UOM funnel: `oHIIKfiw`;
  - the pending clamp and its report: `ClampMsg`;
  - line status: `Z5JH4g2u`;
  - GD line status and the all-or-nothing bundle rule: `iES7iMKA`.
- **Full Picking** (stage 1b), as `Z5JH4g2u` / `iES7iMKA` do with `allow_full_picking`:
  - any picked quantity closes the line (Completed, pending 0); the rest goes to a new Picking
    through Convert to Picking;
  - under a bundle, anything picked must be picked in full;
  - a GD line's picked quantity is counted over the records of **every** Picking
    (`sql_node_PPpicked`); above the GD quantity the pick is refused before anything is written
    (`PK_OVER_PICK`, PICKING's message).

**PREPARE, a pick that moves stock (1c):**

- `sql_node_PPmove` reads the moved GD lines, every bin / batch / HU they name, and per moved GD its
  line count, linkage and other open confirmations; targets are checked (a bin of the plant, a batch
  of the item).
- `code_node_PPmove` rewrites each moved line's allocation as classic `iES7iMKA` does (relocate a
  full pick, split a partial one, rebuild `view_stock`); a moved record with no matching allocation
  entry is refused (`PK_MOVE_NO_ALLOCATION`). The new allocations are kept as `MV|<nonce>|ALC` part rows.
- A loop calls `GD_REPLAN` per moved GD (≤ 25) with the lines' new cells. Its answer must match
  (planned, nothing minted, no line added or removed, no reorder change, the same allocation and
  stock text, no other line's allocation changed); it reads only its own GD's cells (the loop item),
  never the whole move, as it runs once per GD; its movements (keys `G<gi>.M<n>`) and reservation writes (creates keyed
  `<job>|R|<gi>.<k>`) are written as `MV|<nonce>|VRD / ENG / RES` part rows.
- No reservation may be planned by two GDs; INVENTORY_BULK_APPLY checks the movements in PLAN mode
  (a shortfall → FAILED `PK_STOCK_<code>`, nothing written). The payload keeps only
  `move: {nonce, operation_key PKM|<job>, has_movements, gd_ids, counts}`; COMMIT reads the parts.

**COMMIT steps:** each step writes absolute values, then a `gd_publish_step` row `<STEP> DONE` after
its read-back passes. A rerun skips DONE steps and redoes an unfinished one.

| Step | Writes | Check |
|---|---|---|
| P0_REVALIDATE | — | picked lines' pending/status and the GDs unchanged since PREPARE, else FAILED + unlock |
| PM1_STOCK (1c) | INVENTORY_BULK_APPLY APPLY `PKM\|<job>` (all-or-nothing; a rerun answers REPLAYED) | first, every attempt: the move's reservations and lines still at PREPARE's before-image, else FAILED + unlock (`PK_STALE`). 409 LOCK_BUSY: waits 15 / 30 / 60 / 120 s (`PM1_WAIT\|n` rows), then FAILED; after the engine recorded an intent: retry → review |
| PM2_RESERVATIONS (1c) | each planned update at its before-image written whole (10 columns, decimals as 8-dp text); creates once by `job_line_key` | at its target = done; anything else → review; read back |
| PM3_GD_ALLOCATION (1c) | the moved lines' `temp_qty_data`, `view_stock`, `prev_temp_qty_data` (= the new allocation, classic's final value), slices ≤ 250 | first: PM2's result still stands (every reservation at its target, every create once), else review; then three-way compare as PM2; read back |
| P1_PICKING | one Picking update: `to_status`, all lines, all records, the header fields from the form | this job's records counted by `job_line_key = <job>\|<row>\|<seq>` |
| P3_GD_LINES | `picking_status`, `prev_temp_qty_data`, slices ≤ 250 | statuses read back |
| P3_GD_LINES, Full Picking | each touched GD line recounted from the records of every Picking (`MNRecompute`): `picked_qty`, `picked_temp_qty_data`, `picked_view_stock`, `picking_status`, + `prev_temp_qty_data`; only lines whose stored values differ, slices ≤ 250 | up to 4 passes in the run: a pass that reads the lines and records (one statement) and finds nothing to write settles the step |
| P4_GD_HEADERS | GD `picking_status` of every GD on the Picking (cancelled skipped) | read back; then **SPLIT** (lease `SPLIT\|…`) |
| P5_PACKING | per GD, in chunks of ≤ 25 GDs (reads, build, ≤ 25 creates per add-node): refresh the existing Packing, or create one (`packing_no` issued + the org's Packing rule, `idempotency_key PKG\|<gd>`) | one live Packing per GD, over all chunks |
| (finish) | Picking `is_processing = 0`, job COMPLETED, message in `progress_message` (`error_code PK_CLAMPED` when a line was reduced) | — |

**Retries:**

- A failed check retries with backoff (2 s, 4 s, 8 s, 16 s; 3 retries).
- Then the job goes to REQUIRES_REVIEW:
  - from PM2 (1c) or P1 to P4, **the Picking stays locked**;
  - at P5, the Picking is unlocked (it is fully saved).
- A run that dies leaves its 10-minute lease; the next worker tick resumes it.
  - The COMMIT lease stays at 10 minutes. Every other V2 COMMIT, GD Edit V2's included, went to 30 on 2026-10-20 after
    bladexfunctions-af found that the engine resumes a second run of a live operation.
  - A resumed run past P0 writes the Picking (P1) without re-checking it.
  - PICKING_LOOP takes a stale Picking lock over after 15 minutes, so a 30-minute lease would leave a classic confirm
    free to land before the resume.
  - Raise it only after P1 re-checks on a resume, or after PICKING_LOOP treats an open CONFIRM_PICKING job as held.
- The worker gives up (FAILED, unlocked) only before anything was written. For a move that means before
  PM1's stock move; after it, every stop is a review.
- Retries are counted per job, not per step: retries spent in PM1 (a dead run, an engine intent) leave
  fewer for PM2 to P4, which then reach review sooner (never a wrong write).

**Manual resume of a REQUIRES_REVIEW job** (after fixing the cause; dev, with a yes first):

```sql
UPDATE gd_async_job SET job_status = 'COMMITTING_PICKING', attempt_count = 0, next_attempt_at = NULL,
       lease_owner = NULL, lease_expires_at = NULL WHERE id = <job>;
```

**A 1c job under review after the stock moved** (PM1_STOCK DONE, or `IBA|DONE` under job_id
`PKM|<job>` in `gd_publish_step`): the stock is at the target, and some reservations or lines may not
be. `error_message` names the step and the rows. The planned values are this job's part rows
(`gd_publish_step`, job_id = `<job>`, step_name `MV|<nonce>|RES|…` = reservation `before` / `after` and
creates, `MV|<nonce>|ALC|…` = each moved line's `before_temp` / `temp_qty_data` / `view_stock`).

1. Find who changed the rows (their update_time, the GD's other jobs and saves since the job started).
2. If that change was meant to stand, the move is superseded: bring the reservations and lines back in
   line with the stock by hand (or re-allocate by saving the GD), then close the job as FAILED with a
   note. Do not resume it: it would stop on the same rows again.
3. If the rows only need the planned values, write them (`after` / the new allocation), then resume
   with the SQL above; PM2 / PM3 find them at their targets and go on (P1 to P6 still run).

**Two sibling Pickings of the same GD line** (Full Picking zone or remainder Pickings) confirmed at
the same time: a P3 pass can write a value that misses the other Picking's records. The next pass
reads again and corrects it. The step is DONE only after a pass finds nothing to write, and the
Picking whose records came last always recounts after them. The old path (mobile → PICKING) writes
once, without that read-back.

## Differences from the old save (deliberate fixes)

- **Attributes come from the stored Picking line**, not the browser: item, unit, bin, batch, HU,
  GD/SO ids. The pick-UOM factor is computed from the Item's `based_uom` / `table_uom_conversion`.
- **Untouched lines keep their status.** The old save wrote every In Progress line it did not pick
  back as Open.
- **Confirmed lines get `picked_qty` 0.** A value left over from a Draft save is no longer resent.
- **`temp_qty_data` is not rewritten.** The old save only tidied it: it merged duplicate bin
  entries, found on 9 prod lines. The GD's allocation is left as the GD saved it.
- **The Packing counts all of this Picking's records.** The old save counted only the last
  confirmation's records unless Full Picking was on.
- **A cancelled Packing is ignored** when looking for the GD's Packing. A Packing numbering rule is
  picked as non-draft, then default.
- **Full Picking: a GD line already Completed is checked for over-picking too.** The old save
  skipped that check for it.
- **P5 works in chunks of ≤ 25 GDs.** Stage 1a read all the Picking's GDs in one search, and a
  search returns at most 100 records: a Picking of 130 GDs got 100 Packings and the step still
  read as DONE.
- **Quantities are rounded to 8 decimals**, and a stored pending's float residue is not reported as a
  clamp (BUG-20261016-023). Classic rounds to 3 decimals.

Stage 1c (a pick that moves stock):

- **Validated before any write.** A swap with no free stock fails in PREPARE and nothing is written;
  classic writes the Picking first, then its GD re-save fails.
- **Only the moved GDs are re-planned;** classic re-saves every GD of a Loading Bay Picking.
- **Only the stock, the reservations and the moved lines' allocation are written.** The cells a full
  GD re-save re-stamps are left as they are (`delivery_cost` (classic blanks it), `customer_id`,
  `gd_total`, `so_id` / `so_no`, `packing_qty`, `net_weight`, `gd_undelivered_qty`), and so are SO lines
  and Item `last_transaction_date`. No CREDIT_LIMIT_CHECK / CHECK_REQUIRED_FIELD: a move changes no
  quantity or price.
- **A moved record with no matching allocation entry is refused;** classic silently moves nothing.
- **Target bins and batches are checked;** a confirmation may move stock on up to 25 GDs of 500 lines
  in total (classic: any number of GDs of up to 500 lines each, re-saved one by one).
- V2's reservation creates carry `job_line_key`, its movements `operation_effect_key`.
- Like classic, the Picking line keeps its stored target: the picked bin / batch is saved on the
  record only (classic `Z5JH4g2u` rebuilds lines from the stored row).

**Live twins, dev 496474, 2026-10-16** (classic PICKING_LOOP vs V2 on identical GDs; snap.py +
diff_twins.py + pick_twins.py): Loading Bay full + partial (split 2 / 3), bin swap, batch swap — stock
movements, balances, reservations (incl. classic's blanked columns on the cancelled rows), the GD
lines' allocation and stock text, the Picking records and the Packing rows equal, apart from the
differences above and run-order noise (the balance snapshot inside `temp_qty_data`; which twin created
a balance row). A swap into a bin with no free stock: FAILED `PK_STOCK_INSUFFICIENT`, nothing written.

## Force Complete (stage 1d — built 2026-10-20, not deployed)

The list's **Force Complete** closes an In Progress Picking with what was picked, in the background:

```
list "Force Complete" ──► PICKING_ASYNC_SUBMIT operation FORCE_COMPLETE ──► CONFIRM_PICKING job (request.operation FORCE_COMPLETE)
   (NOT_ELIGIBLE + classic_ok 1 → classic PICKING_LOOP isForceComplete 1)
WORKER ─► PREPARE        fcPlan from the database → each delivery's change as parts FCD|<nonce>|<gi>|<nnn> + READY_TO_COMMIT
       ─► PICKING_FC_DRIVE   each tick until FC_GDS; it never runs a delivery's PREPARE / COMMIT itself:
                         F0 (unchanged since PREPARE?) → GD_EDIT_SUBMIT per delivery (source PICKING_FC, held)
                         → all held: FC_HOLD, COMMITTING_PICKING → RELEASE one delivery at a time → FC_GDS
       ─► COMMIT         (the tick that writes FC_GDS) P0 → P1 rows Completed / Cancelled, Picking Completed → P4 → P5 → P6
the screen ─► GD_EDIT_WORKER {job_id} for every edit STATUS (or the WORKER) names in `kick`: each in its own request
```

Each delivery, through GD Edit V2 (`Goods Delivery/EditV2`, source `PICKING_FC`):

- picked lines shrink to the picked quantity, allocated at the picked bins / batches / HUs (temp_qty_data from
  the records, view_stock in classic's text, temp_hu_data filtered and scaled); plan_* and is_force_complete stamped;
- lines with nothing picked are removed; a bundle is kept whole (all picked) or removed (none picked);
- the unpicked quantity's reservations are released GD → SO → Production, the SO gets it back, its stock goes back
  to Unrestricted.

Deliveries cancelled before the force complete are skipped (their rows close Cancelled); completed ones too (their
open rows close Completed; P4 / P5 leave them alone).

**Classic** (NOT_ELIGIBLE): the switch off, Picking Plan pickings, Full Picking, Auto Complete GD, Loading Bay, a
delivery with serial items, select picking or internal trading. `classic_ok` 0 (above 500 lines or 25 deliveries in
total) → the list shows the reason and does not run classic.

**Refused, nothing written:**

| Code | When |
|---|---|
| PK_FC_NOT_IN_PROGRESS | the Picking is not In Progress |
| PK_FC_TOO_BIG | more than 25 deliveries or 2,000 delivery lines |
| PK_FC_NO_RECORDS | nothing picked |
| PK_FC_GD_UNPICKED | a live delivery with nothing picked: cancel it first, then force complete |
| PK_FC_SHARED_LINE | a line also on another open Picking |
| PK_FC_UOM | a row's unit differs from its line's order unit |
| PK_FC_OVERPICK | records exceed the line's quantity (legacy data) |
| PK_BUNDLE_SHORT | a bundle partly picked |
| PK_FC_SETUP_CHANGED | Picking Setup changed since SUBMIT |
| PK_FC_STALE | DRIVE's F0: the Picking, its rows, records or delivery statuses changed since PREPARE |
| PK_FC_GD_CHANGED / _NOT_ELIGIBLE / _REFUSED | GD Edit V2 refused a delivery while holding: every hold is cancelled first |

**Under review** (REQUIRES_REVIEW, the Picking stays locked): a delivery's edit failing after the first release
(its own code, e.g. GDE_STALE after 2 re-plans, GDE_E1_REFUSED), COMMIT's P0 finding a change (PK_FC_STALE), a
line the force complete did not plan still open at P1. The deliveries committed so far stay reduced.

**Runbook for a review** (proven in `scratchpad/pk1d/sim/test_flow_1d.js`, case F2b):

1. Fix the cause.
2. The job's FC_REVIEW step: rename it and soft-delete it (`step_name = CONCAT(step_name, '#', id)`, `is_deleted = 1`).
   The unique key (tenant, job, step) ignores `is_deleted`: a row only soft-deleted blocks the next FC_REVIEW.
3. The failed delivery's EDIT_GD job: soft-delete it, so the force complete reads that delivery as not submitted and
   submits it again (a failed edit that is not stale would otherwise send it straight back to review).
4. The job: back to COMMITTING_PICKING with attempt_count 0, next_attempt_at now, lease and error columns cleared.

The next kick re-plans the failed delivery and goes on.

**Pacing.** No scheduler: the list follows each job while it moves (STATUS every 3 s; each `kick` id run with
GD_EDIT_WORKER, then the worker kicked again; a re-kick every 15 s): it stops after 180 s without progress (an edit
still running counts as progress) and after 15 minutes in all, telling the user to keep the list open or open it again. A hold lasts 30 minutes; a hold whose force
complete has ended is cancelled by the next GD_EDIT_WORKER run. Opening the Picking list or the Picking form starts
both workers again.

**Switches:** `STAGE.FORCE_COMPLETE` in SUBMIT's `code_node_PSdecide` and `ASYNC_FORCE_COMPLETE_ENABLED` in the list
handler, both off; they go on together (the list's dialog describes the background force complete). With the list's
switch on, a Picking SUBMIT sends back (NOT_ELIGIBLE, classic_ok 1) runs classic and its result says so.

Built from `scratchpad/pk1d/` (`patch_pk1d.py` from the deployed SUBMIT v9 / WORKER v3 / PREPARE v10 / COMMIT v10 /
PICKING_LOOP v88; `build_drive.py`; `sync_clients.py` for the list page / form), with GD Edit V2's `scratchpad/gde`.
Tests in `scratchpad/pk1d/test/`; the end-to-end simulator `scratchpad/pk1d/sim/test_flow_1d.js`. The design and
the ledger of decisions: `~/.claude/plans/delightful-imagining-naur.md`, `.superpowers/sdd/picking-v2-1d/progress.md`.

## Known limits

- **P1 reads the Picking with one get-node**, which joins every line with every record (as PICKING's
  `get_node_jEllcWiJ` does). A first confirmation of 2,000 lines is fine (no records yet). A second
  confirmation of a Picking that already holds ~1,000 records reads lines × records rows and gets slow.
- **A step retry (`PK_STEP_RETRY`) waits for the next worker tick.** Without the Quartz row below,
  that is the next kick from the form or the list.
- **1c holds no GD lock.** PM1's re-check covers the time from PREPARE to the stock move; a classic GD
  save landing after it (between PM1 and PM2, or PM2 and PM3) sends the job to review.
- **1c lock waits move on worker kicks.** A PM1 wait (`PK_LOCK_WAIT`) resumes on the next kick (the
  Picking form, the list, a new confirmation). P0 is not run again after a wait; PM1 re-checks the
  move's reservations and lines, so a classic save of the moved lines in between fails the job clean.
  If no kick comes for over 15 minutes, classic may take the stale Picking lock and confirm other lines
  of the same Picking; the Picking's header status can then need a manual fix.
- **1c size** (simulator, a code node's injected inputs counted as node data): 25 moved GDs / 500 lines
  (the cap) = PREPARE 10.9 MB, COMMIT 16.1 MB per run; the worker's chain about 40 MB with the
  GD_REPLAN and stock-engine runs. Not measured on dev at the cap.

## Workflows (dev ids)

| Workflow | id | Called by |
|---|---|---|
| PICKING_ASYNC_SUBMIT | 2109531449614647297 | Picking form, Picking list |
| PICKING_ASYNC_WORKER | 2109531412499251201 | form / list (one kick per job) + Quartz |
| PICKING_BULK_PREPARE | 2109531157594619905 | WORKER |
| PICKING_BULK_COMMIT | 2109531367339180034 | WORKER (twice per tick on a SPLIT) |
| GD_REPLAN | 2111017709176225794 | PREPARE (1c), once per moved GD; writes nothing |
| INVENTORY_BULK_APPLY | 2109916822821744641 | PREPARE (PLAN) + COMMIT PM1 (APPLY), shared with GD V2 / Location Transfer V2 |
| PICKING_FC_DRIVE | 2112471278794440706 | WORKER, for a force complete until FC_GDS (1d) |
| GD_EDIT_SUBMIT / GD_EDIT_WORKER | 2110618741159940097 / 2110618789356687361 | DRIVE (SUBMIT / RELEASE / CANCEL_HELD) / the screen (1d) |

Client files:

- `pkV2_onSave_Completed.js`: form event `pkV2_onSave_Completed`, on the Completed button.
- `pkV2_listAutoPick.js`: the list's `AutoPickingComplete`.
- `pkV2_listForceComplete.js`: the list's `ForceCompletePicking` (1d; the classic copy stays in
  `Bulk Actions/Warehouse Management/Picking/ForceCompleteWorkflow.js`). The list's `mounted`
  (`Picking Plan/PPonMountedListPage.js`) starts PICKING_ASYNC_WORKER and GD_EDIT_WORKER; Revert Completed refuses a
  Picking force completed through V2.
- `PickingonMounted.js`, `pkV2ShowJobState`: reads the Picking's latest job through SUBMIT with
  `operation: "STATUS"` (read only). The browser cannot read `gd_async_job` itself: "GD Async
  Job数据表尚未发布", the table has no published form.
  - While a job is open, it hides the save buttons.
  - It reports a FAILED, under-review or reduced result once.

## Deploy (dev)

1. Create the four empty workflows with the names above.
2. Regenerate with their ids.
3. Paste and enable:
   - PREPARE, COMMIT, WORKER, SUBMIT;
   - then the Picking form (`Picking/PickingFullJSON.json`);
   - then the Picking list page (`Picking/PickingListPageFullJSON.json`, built on dev v216).
4. Optional: a Quartz `WorkflowJob` row per tenant for PICKING_ASYNC_WORKER (group "Picking V2",
   class `org.springblade.modules.sucode.job.WorkflowJob`, no params, every 1–5 min). This is the
   only retry path when a kicked run dies.

**Stage 1b on dev** (WORKER and the client handlers are unchanged):

1. PICKING_BULK_PREPARE and PICKING_BULK_COMMIT, in either order. They still run stage 1a jobs the
   same way; a payload without `full_picking` takes the normal P3.
2. Then PICKING_ASYNC_SUBMIT: its `STAGE.FULL_PICKING = true` is what sends Full Picking here.

**Stage 1c on dev** (2026-10-16; built from `scratchpad/pk1c/`, tests and simulator there):

1. GD_REPLAN (`scratchpad/pk1c/build_replan.py`), into an empty workflow.
2. COMMIT, PREPARE and SUBMIT together, switches off (`scratchpad/pk1c/patch_pkv2.py` rebuilds them
   from the deployed 1b versions; GD_REPLAN's id comes from `scratchpad/pk1c/ids.json`).
3. SUBMIT with `STAGE.LOADING_BAY` / `STAGE.BIN_MOVES` on; live twins.
4. The Picking form: `pkV2_onSave_Completed` sends a moved line with its target instead of the classic
   save.

**Stage 1d on dev** (built 2026-10-20 from `scratchpad/pk1d/`; each publish with the user's yes, bases checked):

1. Batch A, switch-independent: GD_EDIT_SUBMIT / PREPARE / WORKER / COMMIT (rebuilt by `scratchpad/gde/build_gde.py`)
   and PICKING_LOOP (its open-job guard); a GD Edit V2 / classic Picking smoke.
2. Batch B: create an empty PICKING_FC_DRIVE in the designer, put its id in `scratchpad/pk1d/ids.json`, re-run
   `patch_pk1d.py --rebase --write` (the WORKER's call takes the id), `build_drive.py --write`; publish DRIVE with
   SUBMIT / PREPARE / WORKER / COMMIT, `STAGE.FORCE_COMPLETE` false.
3. The Picking list page and the Picking form (`sync_clients.py` output). Then the live twins, then the switch.

**Prod:** next week's full deployment promotes dev as it stands, with these switches on. Switching
them off (SUBMIT only) sends moves and Loading Bay back to the classic save.
