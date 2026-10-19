# GD Edit V2: background Edit + Save as Created (dev)

Saves an edit of an existing Goods Delivery (Created, or Draft saved as Created) in the background, so a 2,000-line
delivery no longer goes through the classic full re-save (GOODS_DELIVERY v242: 58 s and 59 MB of node data for a
3-line change; it took dev down on 2026-10-09). Same machinery as GD Completed V2 (`Goods Delivery/CompleteV2`).

**Status (2026-10-16): live on dev.** The four workflows (SUBMIT v8, PREPARE v5, COMMIT v5, WORKER v5), the GD form (v1478: Save as Created, the
Processing view, the Edit-open batching), the GD list's worker kick (v394), the Picking-side guards and the Sales Order
cascade (SO_CASCADE v26, SO_SAVE v168, SO form v1237). Live tests passed on 711077:
- a 1,948-line header edit;
- quantity edits;
- twins against the classic save: a quantity edit; Draft → Created with auto-allocation; removing and adding lines;
- twins with Picking switched on for the tests, then off again:
  - a Picking created by an edit;
  - an unstarted Picking rebuilt (lines lowered, one removed);
  - a started Picking reconciled: a picked line raised (reopened), two lowered, one reversed through the 413;
- the Picking-side refusals;
- Sales Order edits through the cascade: a decrease, a 414 raise, an appended line, and a change plus an append in one save.

- 2,000-line deliveries (GD/20261016/019): Draft → Created with save-time auto-allocation, a 3-line change, 10 lines
  removed and added back, every line lowered, and a cascade's edit. Each was one worker call of at most 95 s; the largest
  run was 32.1 MB of node data (phase B with every line changed).

**Final review (2026-10-16, fresh reviewer): fixed on the branch, not yet published.** Two critical defects (a Picking left
locked after a header-sync-only edit; JSON read-backs failing on MySQL's key order, which froze the delivery under review)
and seven important ones; each fix has a test that failed first. See "Final review fixes" below.

A Sales Order edit cannot update a delivery above 500 lines (was 1,000): SO_CASCADE refuses it with the reason, before
anything is submitted. SO_SAVE now commits each released edit inside the same save, and at 1,000 lines the whole request
(SO save + cascade + SUBMIT + PREPARE + COMMIT) would pass the 55 s gateway. 500 is prod's classic limit. At 2,000 lines the
classic SO save (about 39 MB of node data) and its cascade took dev down on 2026-10-16. Big Sales Order edits need an
asynchronous SO save.

## How it works

The GD's own lock is GD Completed V2's (`gd_publish_step` job `GDC|<gd>`, step `LOCK|<n>`; the owner is the latest
LOCK row). While the edit runs, the GD is `Processing` and its Picking has `is_processing = 1`.

| Workflow | Role |
|---|---|
| `GD_EDIT_SUBMIT` (sync) | The edit as a delta against the GD as stored. Runs GOODS_DELIVERY's gates, lifted, in its order with its codes (401 / 400 / 402 / 403 / 413). Then: lock, `EDIT_GD` job QUEUED, GD Processing, Picking locked (its version recorded). Answers QUEUED / BUSY / NOT_ELIGIBLE / a stop. `STATUS` reports the job holding the GD's latest lock, whichever command. |
| `GD_EDIT_WORKER` | Kicked by the caller; no Quartz. Claims due `EDIT_GD` jobs, calls PREPARE once and COMMIT up to four times per tick. Cancels a cascade's hold that expired (15 min) and unlocks the GD and its Picking. |
| `GD_EDIT_PREPARE` | Set-based reads with no row limits. Runs GOODS_DELIVERY's Edit/Created path and GD_UNUSED_FN_NEW's planner, lifted, in-process. Writes the payload parts (`P|<nonce>|<PART>|nnn`): ENGINE, GDL, GDH, RES, SO, PICK, STAMP, AFTER. Runs INVENTORY_BULK_APPLY in PLAN mode. Ends READY_TO_COMMIT, HELD (a cascade's job), or FAILED with the GD and its Picking unlocked. |
| `GD_EDIT_COMMIT` | Phase A: E0 revalidate, E0N a Draft's number, E1 inventory, then SPLIT. Phase B: E2 lines, then SPLIT. Phase B2: E3 reservations, E4 sales orders, then SPLIT (one call each: at 2,000 changed lines a single phase B was 32 MB of node data). Phase C: E5 Picking and line stamps, E6 header (the unlock), E7 reorder and item dates, then COMPLETED. Each step writes only rows still at PREPARE's before-image, reads them back, and records a DONE row. A rerun resumes. A conflict after the stock moved goes to REQUIRES_REVIEW. |

Job statuses: QUEUED → VALIDATING → READY_TO_COMMIT → (HELD) → COMMITTING_GD → COMPLETED | FAILED | CANCELLED, or
REQUIRES_REVIEW. Only COMPLETED / FAILED / CANCELLED are terminal; GD_COMPLETE_SUBMIT treats any other EDIT_GD status as
busy.

Not taken by V2 (they go to the classic save; above 500 lines the edit is refused with the reason):
- serial-numbered items;
- a Picking Plan GD;
- a loading-bay organization;
- more than one live Picking, or a Picking shared with other GDs;
- internal-trading linkage;
- an edit that changes the plant (only possible on a Draft; every read is scoped to the stored plant).

Edits V2 takes but the inventory engine refuses for data the classic save handles (costing rows that need migration, a
duplicate balance row, a negative price: `GDE_INVENTORY_UNSUPPORTED_COSTING` / `_DUPLICATE_BALANCE` / `_UNSUPPORTED_PRICE`)
fall back to the classic save: the form runs today's handler with the edits still on screen once PREPARE has put the
delivery back; SO_CASCADE saves that delivery classically in the same pass (its 500-line cap applies). A stock shortage
stays a refusal, as in the classic.

Deliberate differences from the classic save:
- Only changed cells are written.
- A Picking whose device lock is older than 900 s (PICKING_LOOP's takeover) does not block the edit; SUBMIT takes the
  lock over. The classic save still answers "being processed on a device".
- Read-backs compare JSON with its keys sorted: a MySQL json column keeps its own key order.
- The stock moves before the GD / SO / Picking writes.
- `delivery_cost` is kept.
- Reservation rows V2 creates carry `job_line_key` (`<job>|C|<n>`), so a rerun cannot create them twice.
- Reorder tracking runs after the writes.
- An unchanged Picking is not rewritten.
- Reservations are read without the classic's limit of 1,000.
- A cascade abort cancels held edits.
- Save-time auto-allocation runs GOODS_DELIVERY's loop and GLOBAL_ALLOCATION v34 in-process on set-based reads. Rows are
  read in id order; the platform's unsorted search order is arbitrary. Allocation sorts by expiry, creation time or
  quantity itself, so only an exact tie can pick a different, equally valid bin or batch.

## Client (paste into the dev designer; built on GD form dev v1476)

**GD list page:** replace its `mounted` with `Goods Delivery/CompleteV2/gdc_list_mounted.js` (GD Completed V2's; it now
also starts GD_EDIT_WORKER when the list opens). Paste it in the same session as the form.

**GD form:** paste `Goods Delivery/GDfullJSON.json` whole, or make these three changes by hand:
1. Add an event script `gde_onClick_save_as_created` = `gde_onClick_save_as_created.js`, and set
   `button_save_as_created` → onClick → it. Keep `gdV2_onClick_save_as_created` and `onClick_save_as_created`: the new
   handler hands them new deliveries and what the background save does not take.
2. Replace `mounted` with `Goods Delivery/GDonMounted.js`.
3. After `Cancel Status`, add a hidden HTML component `processing_status`: a copy of `Completed Status` with the text
   `Processing`, border `#ffbb00`, background `#fffcdd` and text colour `#8f6a04` (the GD list's Processing tag).

Then `.dbtools/form status goods_delivery "Goods Delivery/GDfullJSON.json"` should say IDENTICAL. After a by-hand
paste the designer picks its own keys, so pull the form into the repo instead.

**Switching GD Edit V2 off** takes two switches, each published on its own:
1. the GD form: `ASYNC_EDIT_ENABLED = false` at the top of `gde_onClick_save_as_created.js` and its copy in
   `GDfullJSON.json` (eventScript `gde_onClick_save_as_created`); every edit then runs today's handler;
2. SO_CASCADE: `GDE_CASCADE_ENABLED = false` in `code_cd_gde_args`; every delivery then goes to the classic save with its
   500-line cap, and nothing is submitted.
Jobs already open finish through the worker (the GD list and the GD form start it). The Picking-side guards and
GOODS_DELIVERY's open-job guard stay; with no new jobs they refuse nothing.

What the form does:
- **Save as Created on a saved delivery:** SUBMIT, with the classic's questions on 401 / 403 / 413. QUEUED starts the
  worker and waits for its check, polling every 2 s for at most 90 s. The worker is started again every 15 s, since a
  job waiting out a retry only moves when kicked.
  - Passed: the "Stock to put back" and credit-limit notes are shown, then the dialog closes.
  - Failed: the reason is shown and the edits stay on screen. An inventory refusal the classic save handles (see above)
    runs the classic handler instead, once the delivery is back from Processing (the form reads `gd_status`, up to 10 s).
  - NOT_ELIGIBLE: the classic handler runs.
  - BUSY because the delivery's GD V2 create has not made its Picking yet: the form starts GD_PICKING_OUTBOX_CONSUMER
    for that delivery's event without waiting (no Quartz on prod), and shows the warning. The GD list does the same for
    every such delivery (bladexfunctions-eb's list `mounted`).
- **Opening a Processing delivery (an edit or a completion running):**
  - The form is read-only and shows a Processing badge.
  - The job's worker is started again, every 15 s while the job runs, and the job is followed for up to 180 s,
    polling every 3 s. 2,000-line completions take 72-108 s.
  - When the job finishes, the list behind the dialog is refreshed.
- **Opening a delivery in Edit** reads items, stock balances and SO lines in batches: 16 reads for about 615 lines,
  instead of about 1,800 one after another (`test/test_edit_open.js` checks every row's result against the v1477 form).

## Picking-side guards (live on dev)

While a delivery is being saved in the background, the Picking side refuses to touch it. "Being saved in the background"
means its `gd_status` is Processing, or an edit or completion job on it is open. The message is "Goods Delivery X is being
saved in the background. Wait a moment, then try again."

| Workflow | Where it refuses |
|---|---|
| `PICKING_ASYNC_SUBMIT` | The facts read the stored Picking's deliveries; the decision rejects before anything is queued. |
| `PICKING_LOOP` | Before the loop, every Picking of the call is checked at once, then the run answers 400. Mobile confirms several Pickings in one call. |
| `PICKING` | The existing size guard reads the deliveries' status with their line counts and answers 400 before any write. |
| `SU: GD_Convert_Picking`, `SU: GD_Line_Convert_Picking` | After reading the deliveries, the run ends with code 400 and the reason. Mobile inserts the Picking itself and checks only that the call succeeded. |

The two convert workflows now have repo copies in `Bulk Actions/Sales & Distribution/Goods Delivery/`
(`GDConvertPickingWorkflow.json`, `GDLineConvertPickingWorkflow.json`). Patches: `scratchpad/gde/guards/`.

## Build and test

```
python3 scratchpad/gde/build_gde.py --write        # the four JSONs here, from scratchpad/gde/code/**
python3 scratchpad/validate.py "Goods Delivery/EditV2/GD_EDIT_COMMIT.json"
scratchpad/gde/test/run_all.sh <session scratchpad>/gde-fx
```

`run_all.sh` runs the lift check, parity on 23 recorded dev runs, the allocation suites (6 recorded Draft → Created runs
with auto-allocation; the SQL reads against the platform's recorded rows, after `test/alloc_rows.py`), the unit suites
(with mutation checks), the form's handler and the real `mounted` on a mock form (`test/test_client.js`,
`test/test_mounted.js`, which also checks the wiring in `GDfullJSON.json`), and the built JSON on GD Completed V2's interpreter (`test/commit_sim.js`) against live read dumps:
- 496474 GD/20261002/056: 499 lines, with a Picking;
- 711077 GD/20261003/006: 1,948 lines.

Scenarios: form submit to COMPLETED; add and remove lines; a crash and resume; a crash after the Picking write; a
stale reservation; stock lock busy; hold, release and expiry.

At 1,948 lines the largest run is COMMIT phase B, at 21.8 MB of node data.

Lifted code is pinned to the deployed versions (`scratchpad/gde/lift/nodes.json`: GOODS_DELIVERY v243,
GD_UNUSED_FN_NEW v55, REORDER_SET_REDIS v21, GLOBAL_ALLOCATION v34). `scratchpad/gde/lift/check_fresh.sh` says when dev has moved on; then
re-lift and re-run parity.

## Deploy (dev only, one batch at a time)

1. Probes on a test GD: a direct insert into the line subform, and a Draft's number written back.
2. The four workflows. Create the dev shells, fill `ids.json`, rebuild, then publish with `.dbtools/wf_upload.mjs`
   (`republish: true`).
3. Picking-side guards and the GD_Convert_Picking guard.
4. The GD form handler and `mounted` view (see Client), and the GD list kick (GD Completed V2's list `mounted`).
5. A reconfigured test organization for the Picking reconcile (done: 711077's picking setup was switched on for the
   tests, then back). `scratchpad/gde/test/live_pick_req.py` makes a partial pick; `pick_twins.py` compares twins' Pickings.
6. SO_CASCADE, SO_SAVE and the SO form (done; SO_SAVE calls SO_CASCADE only when a delivery or picking plan names the
   order; the SO form's Issue and Post handles the cascade's answers as Issue does). The cascade sends each delivery's
   payload to GD_EDIT_SUBMIT, and the worker prepares it and holds it. SO_SAVE releases the holds after the SO write and
   commits each in the same save (GD_EDIT_WORKER on the job), so mobile Sales Order edits and the quotation cascade need
   no kick; a refused pass A cancels its holds. An edit that did not complete comes back as `data.gdEditNotes`, which the SO
   form shows ("Deliveries not updated"). A worker started without a job (the GD list, the form) skips an edit released in
   the last 10 s, so it never races SO_SAVE's own call. Patches: `scratchpad/gde/cascade/` (`patch_cascade_switch.py`,
   `patch_cascade_fallback.py`, `patch_cascade_cap500.py`, `patch_so_save_commit.py` for the final review).

## A job under review (REQUIRES_REVIEW)

A job goes to review when a step finds rows someone else changed after the stock moved (E1), or when its retries run
out. Its delivery stays Processing, and every save path treats it as busy (GD_EDIT_SUBMIT, GOODS_DELIVERY's open-job
guard, the Picking guards, PACKING_SAVE) until it is repaired. Users see "... under review: please contact support".

1. List them: `python3 scratchpad/gde/tools/review_jobs.py --prod` (read-only; `--tenant T` narrows it). Each line shows
   the steps already DONE and the reason (`error_code`, `error_message`; `error_details` names the step).
2. Read the job's step rows (`gd_publish_step` where `job_id` = the job): the `<STEP>` DONE rows, the intents (`E0N|I|`,
   `E5|I|`) and the payload parts (`P|<nonce>|<PART>|nnn`: what the job meant to write).
3. `E1_INVENTORY` not DONE: nothing irreversible happened, so cancel it.
   - The job: FAILED (`error_code` GDE_REVIEW_CANCELLED), lease cleared, `finished_at` now.
   - The delivery: `gd_status` back to `request_payload.stored_status` (Created or Draft), if it is Processing under this
     job's lock (the latest `GDC|<gd>` LOCK row's `result_ref` = the job's `idempotency_key`).
   - Its Picking: `is_processing` 0 if it is still at the job's version (`request_payload.picking_version`, else the
     prepared payload's).
   The user then saves the edit again.
4. `E1_INVENTORY` DONE (the stock moved): finish it instead.
   - From the reason, find the row someone changed after PREPARE read it, and decide with the user whether that change
     stays.
   - If it can be overwritten: set the job back to COMMITTING_GD with `attempt_count` 0, `next_attempt_at` now and the
     lease cleared, then start `GD_EDIT_WORKER` with `{ job_id }`. DONE steps are skipped; each remaining step writes only
     rows still at their before-image, so a conflict that remains sends it back to review with the reason. E1 replays
     safely (INVENTORY_BULK_APPLY answers REPLAYED for an operation it already applied).
   - If the change must stay: the remaining parts are applied by hand from the payload parts. That is a developer task.
Every write above is a database write: show it and get a yes first (`.dbtools/dbw` on dev; the user on prod).

## Final review fixes (2026-10-16)

| Finding | Fix |
|---|---|
| C1: a header-sync-only edit left the Picking locked | E5 records the synced Picking's version; E6 unlocks at it |
| C2: JSON read-backs failed on MySQL's key order (`gd_ref_doc`, `custom_fields`, `assigned_to`, ...) | `sameVal`, `geGdParts` and the delta compare JSON with sorted keys; E5 skips an `[]` the platform does not write |
| 1: released cascade edits waited for a client kick | SO_SAVE commits them in the same save; the cascade cap is 500 lines; worker polls skip an edit released under 10 s ago |
| 2: cascade failures after the SO write were silent | SO_SAVE answers `gdEditNotes`; the SO form shows them |
| 3: no single switch | `GDE_CASCADE_ENABLED` in SO_CASCADE, with the form's `ASYNC_EDIT_ENABLED` (see "Switching GD Edit V2 off") |
| 4: inventory refusals with no classic fallback | the form and SO_CASCADE fall back to the classic save for the three data codes |
| 5: BUSY with no exit on an unfinished GD V2 create | the form starts the outbox consumer, fire and forget; the GD list nudges it too |
| 6: no runbook or listing for jobs under review | "A job under review" above; `scratchpad/gde/tools/review_jobs.py` |
| 7: Picking lock leaks | a stale device lock (> 900 s) no longer blocks an edit; PREPARE adopts the version SUBMIT did not record |

Plan: `~/.claude/plans/gd-edit-v2.md`. Rulings: `.superpowers/sdd/delightful-imagining-naur/progress.md`.
