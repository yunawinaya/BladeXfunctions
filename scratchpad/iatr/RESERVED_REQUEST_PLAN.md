# Reserved transfer requests with defect handling: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an IA saved as Created requests its reserved components. Dispatch swaps the reservation into transit in one locked
step. Receive lands good stock reserved at the staging bin and defects as Blocked. A replacement or Report defect covers what is
missing. An Item Assembly Setup switch turns the whole feature on or off.

**Architecture:**
- A new pure rule file (`iatr_reserve.js`) is inlined into IA_TRANSFER_REQUEST, LOT V2 SUBMIT / PREPARE / COMMIT and the IA form.
- Stock moves only through LOT V2 (dispatch, receive, cancel back) and IA_TRANSFER_REQUEST (DEFECT), each as one
  INVENTORY_BULK_APPLY operation.
- RES-01's reservation rows (`on_reserved_gd`, doc_type "Item Assembly") are written in IA_HOLD's own shape, so IA_HOLD keeps
  owning them.
- IA_SAVE / IA_V2_SUBMIT get new guard versions; the older builds keep their md5 pins.
- The setup is a new org-level table and form, copied from Picking Setup.

**Tech stack:**
- BladeX low-code workflow JSON, built by Python builders on `scratchpad/iav2/lib`, with ES2015 code-node bodies.
- Node test harnesses and mutants.
- Dev publish through `node .dbtools/wf_upload.mjs`.

**Spec:** `Item Assembly & BOM/TransferRequest/RESERVED_REQUEST_DESIGN.md`, approved by the user 2026-10-29, with D1–D13. It
changes `scratchpad/iatr/SPEC_SOURCE.md` (IA-LT-04 reversed, D8).

## Global Constraints

- **Git:** no git commits; the user handles git. A task ends with its tests green and one ledger line, not a commit.
- **Ledger:** `.superpowers/sdd/RESERVED_REQUEST_PLAN/progress.md`, created by `sdd-workspace`.
- **Publishing:**
  - Every DEV publish is a backup + `--dry-run` + one user yes per batch (AskUserQuestion) + `--publish` + a check that the
    result is IDENTICAL.
  - Prod is pasted by the user.
  - Nothing is published between 10 pm and 1 am.
  - Check what is live right before editing a base and right before publishing (wf_upload `base` guard).
  - Never republish `Item Assembly & BOM/AsyncV2/IA_SAVE.json`, `IA_V2_SUBMIT.json` or `IAform.json`; the SmallCycle builds own
    them.
- **Before editing workflow JSON:** invoke `authoring-lowcode-workflows`, and run `python3 scratchpad/validate.py <file>` on
  every built workflow.
- **Before save or inventory edits:** invoke `avoiding-bladex-data-traps`.
  - The decimal `defect_qty` must be formatted with `toFixed` wherever it is written (multipleOf).
  - Remainders are clamped at 0.
- **DB writes:** confirm before any write. Dev writes go through `.dbtools/dbw` only, with a yes. Prod is SELECT-only.
- **Dev tenant 711077:** tell bladexfunctions-3f before using its stock. Never touch the "blade, loose" item (2105492637718319110
  at bin 2106278340907413505), SO/20261016-034 or SO/20261016-035. Keep RES-01 tests off item 2783-000000-00.
- **runas:** run `runas.mjs` as its own command, never chained; never print or save tokens.
- **Shared code:** new shared helpers go in NEW files, because older builds inline `code/shared/*` and assert md5 pins.
- **Membership:** `MEMBER_EXPR` is a COUNT; check `> 0`.
- **Request stock moves:** LOT V2 only, at any size. The classic Save Picks stays stock-neutral.
- **Every switch defaults OFF:** the setup (no row = off) and the builders' `RR_ENABLED`. OFF stops only new first requests (D13).

## Review Focus

1. **A reservation spanning several bins or batches of one line, picked at a different mix.**
   - Expect: the swap releases exactly the held keys and stages exactly the picks.
   - Expect: the bins to count are listed.
   - Test: `test_iatr_reserve.js` "swap: two held keys, three picks".
2. **IA_HOLD partly released a line's hold between request and dispatch** (Partially reserved).
   - Expect: dispatch refused as stale, and nothing moves.
   - Test: `test_lot_v2_submit.js` "dispatch: holds below requested → IATR_HOLD_STALE".
3. **Two IAs receiving the same item into the same staging bin.**
   - Expect: each IA's Receive writes its own reservation rows and picks.
   - Expect: neither IA's staging pick or IA_HOLD takes the other's stock.
   - Test: `test_lot_v2_commit.js` "receive: second IA at same staging bin".
4. **The IA line's unit differs from the item's base unit.**
   - Expect: hold rows and IA picks in the line unit, and engine movements in base quantity, q8 throughout.
   - Test: `test_iatr_reserve.js` "receive plan: CTN line, EA base".
5. **Another LOT's in-transit stock at the same destination bin.**
   - Expect: Receive moves only this request's in-transit quantity.
   - Test: `test_lot_v2_prepare.js` "receive: shared destination in-transit".

---

### Task 0: Pin the live bases; the user's setup shell

**Files:**
- Create: `scratchpad/iatr/base/` copies, each with an md5 recorded in `scratchpad/iatr/base/PINS.md`:
  - IA_TRANSFER_REQUEST v7
  - LOT_V2_SUBMIT v6, PREPARE v8, COMMIT v9, WORKER v7
  - SM_LOCATION_TRANSFER v86
  - IA_HOLD v13
  - IA_SAVE v27, IA_V2_SUBMIT v16
  - IA form v80, LOT form v118
  - the LOT list and IA list pages (current)
  - the picking_setup form v25 (template)

**Interfaces:**
- Produces: the pinned bases that every later builder asserts (md5) before patching.

- [ ] Step 1: For each target, pull the enabled version (SQL on `su_code_*_history`, status 'enabled', max version) into
  `scratchpad/iatr/base/`. Record name, id, version and md5.
- [ ] Step 2: Ask the user to create, on dev:
  - the form "Item Assembly Setup" (table `item_assembly_setup`), as an empty shell;
  - its menu entry.

  Record its form id in `scratchpad/iatr/ids.json`.
- [ ] Step 3: List dev's open requests made from Draft IAs:
  `SELECT stock_movement_no, stock_movement_status FROM sm_location_transfer WHERE transfer_purpose='IA_SUPPLY' AND is_deleted=0 AND stock_movement_status NOT IN ('Completed','Cancelled')`.
  Ask the user whether to cancel them, with a yes for each write. Use IA_TRANSFER_REQUEST CANCEL, not SQL.
- [ ] Step 4: Ledger line: bases pinned, ids recorded.

### Task 1: The rule file `iatr_reserve.js`

**Files:**
- Create: `scratchpad/iatr/code/shared/iatr_reserve.js`. It is pure ES2015, `module.exports` guarded, and has no platform calls.
- Test: `scratchpad/iatr/test/test_iatr_reserve.js`
- Test: `scratchpad/iatr/test/mutants_iatr_reserve.js`

**Interfaces:** Produces the following. Quantities are q8 text in the line's unit; ids are text.

| Function | Returns |
|---|---|
| `rrSetupOn(setupRows, orgId) → boolean` | The org's first row's `transfer_request_enabled === 1`; no row = false |
| `rrLinesFromHolds(iaLines, holdRows, items) → { lines: [{ source_ia_line_id, item_selection, quantity_uom, requested_qty, picks: [{ location_id, batch_id, sm_quantity, hold_row_id }] }], skipped: [{ line, reason }] }` | One line per stock line with held quantity. Serial, HU and non-stock lines are skipped with their reason. |
| `rrSwapPlan(lotLines, holdRows, opKey) → { ok, code, message, release: [...], stage: [...], cancelRows: [ids], countBins: [{ line, reservedAt, pickedFrom }] }` | Release = Reserved → Unrestricted at the held keys (isMovingInv 1). Stage = the picks as today's STAGE. Refuses when the held quantity ≠ requested (`IATR_HOLD_STALE`) or the picks ≠ requested. |
| `rrReceivePlan(lotLines, receipts, dest) → { ok, code, message, toReserved: [...], toBlocked: [...], newHoldRows: [...], iaPicks: { [iaLineId]: picks }, lineDefects: [{ id, defect_qty, defect_reason, defect_detail }] }` | `receipts` = per line, or per batch for batch-managed items: `{ good, defect, reason }`. Good + defect = dispatched (D5). A reason is required when defect > 0 (D7). |
| `rrCancelBackPlan(lotLines) → { toReserved: [...], newHoldRows: [...], iaPicks }` | Back to each picked key, reserved for the IA (D3) |
| `rrDefectPlan(iaLines, holdRows, stagingBin, defects) → { ok, code, message, moves: [...], holdChanges: [...], iaPicks }` | Reserved → Blocked at the staging bin, under transaction type IA-D. Refuses more than is held. |
| `rrGap(iaLines, holdRows, requests, items) → [{ iaLineId, missing }]` | Demand − held − in transit, for lines a request can carry (D11) |
| `rrStagingCheck(iaLines, requests, items, stagingBin) → { ok, line, message }` | Once the IA has any non-cancelled request, every requestable stock line's picks must be at the staging bin. Serial and HU lines are exempt (D11). |

- [ ] **Step 1: Write the failing tests.** These names, with these assertions:
  - "setup: no row → off"; "setup: org row 1 → on"
  - "lines from holds: partial hold → requested = held" (D1)
  - "lines from holds: serial line skipped with reason"
  - "swap: picks at the held keys → release + stage net, no countBins"
  - "swap: two held keys, three picks" (Review Focus 1)
  - "swap: held < requested → IATR_HOLD_STALE"
  - "receive plan: good 7 defect 3 → 7 Reserved + 3 Blocked + hold rows for 7"
  - "receive plan: defect without reason → refused"
  - "receive plan: good+defect ≠ dispatched → refused"
  - "receive plan: CTN line, EA base" (Review Focus 4)
  - "receive plan: batch item defect in one of two batches → only that batch Blocked"
  - "cancel back: to picked keys, Reserved, hold rows"
  - "defect plan: more than held → refused"
  - "gap: never-reserved line counted; serial line not"
  - "staging check: never-reserved line picked from warehouse → refused; serial line from warehouse → ok"
- [ ] **Step 2:** Run `node scratchpad/iatr/test/test_iatr_reserve.js`.
  Expected: FAIL (`Cannot find module ... iatr_reserve.js`).
- [ ] **Step 3:** Implement the functions with the signatures above. Hold rows follow RES-01's shape
  (`scratchpad/iasc/res01/code/sql_hold.py` STATE `rows`: id, status, doc_line_id, material_id, bin_location, batch_id,
  from_category, open_qty, reserved_qty, item_uom, job_line_key). New rows carry `job_line_key` `IATR|<lotId>|<k>`.
- [ ] **Step 4:** Run `node scratchpad/iatr/test/test_iatr_reserve.js`. Expected: all pass.
- [ ] **Step 5:** Run `node scratchpad/iatr/test/mutants_iatr_reserve.js`. Expected: every mutant killed.
- [ ] **Step 6:** Ledger line (`task-done ... -- node scratchpad/iatr/test/test_iatr_reserve.js`).

### Task 2: The Item Assembly Setup form

**Files:**
- Create: `scratchpad/iatr/setup/build_ia_setup.py`. Its template is `Picking/PickingSetupFullJSON.json`, reduced to
  `organization_id`, `plant_id` and `transfer_request_enabled` (switch).
- Create: `scratchpad/iatr/setup/src/iaSetup_onMounted.js` (copies `Picking/PickingSetupOnMounted.js`) and
  `iaSetup_save.js` (copies `Picking/PickingSetupSave.js`: one row per plant of the org; an org with no plants gets
  `plant_id` = org).
- Output: `Item Assembly & BOM/Setup/ItemAssemblySetup.json`
- Test: `scratchpad/iatr/test/test_ia_setup.js`

**Interfaces:**
- Consumes: the shell's form id (Task 0).
- Produces: the `item_assembly_setup` columns that the readers in Tasks 7 and 9 use.

- [ ] Step 1: Write failing tests:
  - "save: org with 3 plants → 3 rows identical";
  - "save: org without plants → 1 row plant_id = org";
  - "mount: reads the org's row, shows the switch".
- [ ] Step 2: Run `node scratchpad/iatr/test/test_ia_setup.js`. Expected: FAIL.
- [ ] Step 3: Build the form and handlers.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Ledger line.

### Task 3: The new Location Transfer fields (field-only)

**Files:**
- Modify: `scratchpad/iatr/lot_client/patch_lot_ui.py`, on the pinned LOT form v118. It adds hidden, inert fields:
  - lines: `defect_qty` (decimal, p8), `defect_reason` (select, datasource `category_transfer_reason`), `defect_detail`
    (textarea → longtext);
  - header: `replacement_for_id` (input).
- Test: `scratchpad/iatr/test/test_lot_ui_full.js` gains "fields: four new, hidden, inert; output minus them == v118".

- [ ] Step 1: Write the failing test.
- [ ] Step 2: Run `node scratchpad/iatr/test/test_lot_ui_full.js`. Expected: FAIL on the new case only.
- [ ] Step 3: Patch.
- [ ] Step 4: Run it. Expected: PASS (the earlier 114 plus the new case).
- [ ] Step 5: Ledger line.

### Task 4: IA_HOLD v14, the in-transit rule

**Files:**
- Modify: `scratchpad/iasc/res01/code/sql_hold.py`. STATE gains `'transit'`: the IA's IA_SUPPLY request that is In Progress or
  Processing.
- Modify: `scratchpad/iasc/res01/code/hold/plan.js`. While `transit` is set, every operation except CHECK answers
  `IN_TRANSIT` with no moves.
- Modify: `scratchpad/iasc/res01/build_hold.py`. The new pin is v13.
- Test: `scratchpad/iasc/res01/test/test_hold_core.js` and `sim_hold.js`
- Test: `scratchpad/iasc/res01/test/mutants_hold.py`

**Interfaces:**
- Consumes: the reservation row shape from Task 1.
- Produces: the `IN_TRANSIT` answer, which the IA form shows as "In transit (LOT-…)".

- [ ] Step 1: Write failing tests:
  - "reconcile while transit → IN_TRANSIT, no moves";
  - "rows written with IATR| job_line_key are own holds";
  - "sweep skips transit IAs".
- [ ] Step 2: Run `node scratchpad/iasc/res01/test/test_hold_core.js`. Expected: FAIL on the new cases.
- [ ] Step 3: Implement.
- [ ] Step 4: Run the tests, sims and mutants. Expected: all pass; an IA with no transit request gives the same calls as v13.
- [ ] Step 5: Ledger line.

### Task 5: LOT V2 PREPARE, COMMIT and WORKER

**Files:**
- Modify: `scratchpad/smv2/code/prepare/plan.js` (and `adapter.js` if needed):
  - **Dispatch:** for a purpose STAGE from a Created IA, prepend `rrSwapPlan` release movements to the STAGE movements, in one
    operation.
  - **Receive:** for a purpose COMPLETE with receipts, use `rrReceivePlan` (to Reserved and to Blocked), not "the source
    category".
  - **Cancel back:** for a purpose CANCEL after dispatch, use `rrCancelBackPlan`.
- Modify: `scratchpad/smv2/code/commit/` (a new step file `l_rr.js` between the engine step and finish). The reservation rows:
  - dispatch: the IA's rows go to Releasing, then Cancelled with the marker;
  - receive and cancel back: new rows inserted as Processing, then turned Allocated, then read back;
  - Receive also writes the IA's line picks, by exact id, then reads them back;
  - Receive writes the LOT line defect fields (`defect_qty` `toFixed(8)` text).
- Modify: `scratchpad/smv2/build_prepare.py`, `build_commit.py`, `build_worker.py` (inline `iatr_reserve.js`).
- Test: `scratchpad/iatr/test/test_lot_v2_prepare.js`, `test_lot_v2_commit.js`, `mutants_lot_v2.js`
- Test: the smv2 goldens under `scratchpad/smv2/test/` stay green.

**Interfaces:**
- Consumes: `rrSwapPlan`, `rrReceivePlan`, `rrCancelBackPlan` (Task 1); `IN_TRANSIT` (Task 4).
- Produces: COMMIT step results `RR_ROWS_DONE` / `RR_ROWS_REVIEW`.

- [ ] Step 1: Write failing tests:
  - "dispatch: one operation, release before stage, rows Releasing→Cancelled";
  - "dispatch: engine refusal → rows back to Allocated, nothing moved";
  - "receive: good→Reserved+rows+IA picks, defect→Blocked+line fields";
  - "receive: shared destination in-transit" (Review Focus 5);
  - "receive: second IA at same staging bin" (Review Focus 3);
  - "cancel back: Reserved at picked keys + rows + IA picks";
  - "ordinary LOT: plan and calls identical to v8 / v9".
- [ ] Step 2: Run `node scratchpad/iatr/test/test_lot_v2_prepare.js && node scratchpad/iatr/test/test_lot_v2_commit.js`.
  Expected: FAIL on the new cases.
- [ ] Step 3: Implement.
- [ ] Step 4: Run them, plus the smv2 goldens (`python3 scratchpad/smv2/test/lib_smoke.py` and the `scratchpad/smv2/test/*`
  runners), plus `node scratchpad/iatr/test/mutants_lot_v2.js`. Expected: all pass, with no golden diff for ordinary LOTs.
- [ ] Step 5: Run `python3 scratchpad/validate.py` on the three built workflows. Expected: no MISSING, FORWARD, DIVERGENT or
  UNDECLARED.
- [ ] Step 6: Ledger line.

### Task 6: LOT V2 SUBMIT

**Files:**
- Modify: `scratchpad/smv2/code/submit/iatr.js` and `entry.js`:
  - **Dispatch:** a purpose dispatch from a Created IA runs `iatrDispatchCheck`, extended for a Created IA, partial requests and
    replacement requests.
  - **Receive:** the payload carries `receipts`, validated by `rrReceivePlan` before the job.
  - **Cancel:** a purpose cancel after dispatch takes the cancel-back route.
  - **Facts SQL:** reads the IA's hold rows for the lines.
- Leave alone: `scratchpad/iatr/code/shared/iatr_rules.js`. It is pinned by older builds. The new checks live in
  `iatr_reserve.js`; `iatrDispatchCheck` stays only for the retired Draft path.
- Modify: `scratchpad/smv2/build_submit.py`
- Test: `scratchpad/iatr/test/test_lot_v2_submit.js`

**Interfaces:**
- Consumes: Task 1, and Task 5's routes.
- Produces: the stop codes `IATR_HOLD_STALE`, `IATR_RECEIPT_INVALID`, `IATR_DEFECT_REASON`.

- [ ] Step 1: Write failing tests:
  - "dispatch: holds below requested → IATR_HOLD_STALE" (Review Focus 2);
  - "receive: defect without reason → IATR_DEFECT_REASON";
  - "receive: good+defect ≠ dispatched → IATR_RECEIPT_INVALID";
  - "cancel after dispatch → cancel-back route";
  - "ordinary LOT unchanged".
- [ ] Step 2: Run `node scratchpad/iatr/test/test_lot_v2_submit.js`. Expected: FAIL on the new cases.
- [ ] Step 3: Implement.
- [ ] Step 4: Run it. Expected: PASS. Then run `validate.py`.
- [ ] Step 5: Ledger line.

### Task 7: IA_TRANSFER_REQUEST v8

**Files:**
- Modify: `scratchpad/iatr/code/shared/iatr_ia.js` (or a new `iatr_ia2.js` if pins require it), `scratchpad/iatr/code/request/{guard,decide,win,done}.js`
  and `scratchpad/iatr/request/request_sql.py`:
  - **Setup read:** `rrSetupOn`. A first request is refused when it is off; an IA that already has a request keeps every
    action (D13).
  - **CREATE** needs a Created IA; lines come from `rrLinesFromHolds`.
  - **REFRESH** rebuilds from the holds (Requested only, D4).
  - **REPLACE** is allowed after a receipt. It sets `replacement_for_id`, and its lines come from the IA's new holds.
  - **DEFECT** runs one engine operation (`rrDefectPlan`, IA-D), the hold changes, the IA picks and read-back.
  - **STATUS** lists all of the IA's requests, plus `setupOn`.
  - **Claim numbering** counts all of the IA's requests.
- Modify: `scratchpad/iatr/build_iatr.py`
- Test: `scratchpad/iatr/test/test_iatr_ia.js`, `test_iatr_request.js`, plus the two mutants files.

**Interfaces:**
- Consumes: Task 1 and Task 2's table.
- Produces: the operations `CREATE` / `REFRESH` / `REPLACE` / `DEFECT` / `STATUS` / `CANCEL` used by Tasks 9 and 10.

- [ ] Step 1: Write failing tests:
  - "setup off + no request → CREATE refused";
  - "setup off + request in transit → REPLACE/DEFECT allowed" (D13);
  - "CREATE on Draft → refused";
  - "CREATE partial";
  - "REFRESH after hold change";
  - "REPLACE before receipt → refused";
  - "DEFECT more than held → refused";
  - "claim n counts received requests".
- [ ] Step 2: Run `node scratchpad/iatr/test/test_iatr_ia.js && node scratchpad/iatr/test/test_iatr_request.js`.
  Expected: FAIL on the new cases.
- [ ] Step 3: Implement.
- [ ] Step 4: Run the tests and both mutants files, then `validate.py`. Expected: all pass.
- [ ] Step 5: Ledger line.

### Task 8: IA_SAVE v16 and IA_V2_SUBMIT v8, the guard

**Files:**
- Create: `scratchpad/iasc/code/shared/iatr_guard2.js` and `iatr_sql2.py`:
  - the read covers all of the IA's requests;
  - `rrStagingCheck` (D11);
  - Created is allowed before a request;
  - any save is refused while a request is in transit;
  - completion is refused while any request is open.
- Create: `scratchpad/iasc/classic/patch_v16.py`, which asserts md5(patch_v15.build()) before patching.
- Create: `scratchpad/iasc/submit/patch_v8.py`, which asserts md5(patch_v7.build()).
- Test: `scratchpad/iasc/test/test_iatr_guard2.js`, plus sim twins in the existing iasc sim harness (as `test_v14_sim.js`).

**Interfaces:**
- Consumes: `rrStagingCheck` (Task 1).
- Produces: the refusal codes `IA_TR_TRANSIT`, `IA_TR_OPEN`, `IA_TR_STAGING`.

- [ ] Step 1: Write failing tests:
  - "save while in transit → IA_TR_TRANSIT";
  - "complete with open request → IA_TR_OPEN";
  - "never-reserved line from warehouse → IA_TR_STAGING";
  - "serial line from warehouse → ok";
  - "an IA with no request → calls and writes identical to v15 / v7".
- [ ] Step 2: Run `node scratchpad/iasc/test/test_iatr_guard2.js`. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run it and the twin sims, then `validate.py` on both builds. Expected: PASS, and the twins are identical.
- [ ] Step 5: Ledger line.

### Task 9: The IA form

**Files:**
- Modify: `scratchpad/iasc/client/src/tr_main.js`:
  - read the setup on MOUNT;
  - the request section only on Created, or when the IA has a request;
  - the requests list;
  - REPLACE, with the offer after RELOAD and the button;
  - Report defect (DEFECT), shown only with the `lot_ia_receive` permission;
  - the "In transit" display.
- Modify: `scratchpad/iasc/client/src/sc_main.js`:
  - the gap allocation for a replacement: `scAllocate` excluding the staging bin, leaving staging picks alone, then a Created
    save, then REPLACE;
  - retire `scOpStaging` (B21).
- Modify: `scratchpad/iasc/client/build_client_sc.py`. Inline `iatr_reserve.js`; `RR_ENABLED`.
- Test: `scratchpad/iasc/client/test/test_tr_form.js`, a new `test_tr_reserve.js`, and `mutants_tr.js`; `node scratchpad/iasc/check_all.js` stays green.

**Interfaces:**
- Consumes: Task 7's operations and `rrGap`.
- Produces: none.

- [ ] Step 1: Write failing tests:
  - "setup off, no request → no section";
  - "Draft → no Request Materials";
  - "offer after RELOAD when the last receipt had defects; declined → button stays";
  - "replacement allocation never picks the staging bin";
  - "report defect → DEFECT payload per batch";
  - "in transit → read-only notice".
- [ ] Step 2: Run `node scratchpad/iasc/client/test/test_tr_reserve.js`. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run it, `test_tr_form.js`, `mutants_tr.js` and `node scratchpad/iasc/check_all.js --mutants`. Expected: all green.
- [ ] Step 5: Ledger line.

### Task 10: The LOT form and list

**Files:**
- Modify: `scratchpad/iatr/lot_client/patch_lot_ui.py`:
  - the pick dialog adds the source IA's own holds back;
  - the Receive dialog has Good / Defect / reason per line, or per batch for batch items;
  - the "Replacement for LOT-…" label;
  - the bins to count, shown on the request.
- Modify: `scratchpad/iatr/lot_client/patch_lot_list.py`: the Receive and cancel routes.
- Modify: `scratchpad/iatr/ia_client/patch_ia_list.py`, re-based on the live IA list. Its Transfer Request column shows the
  latest open or received request.
- Test: `scratchpad/iatr/test/test_lot_ui_full.js`, `test_lot_ui.js`, `test_lot_list.js`, `test_ia_list.js`, and the mutants
  files.

**Interfaces:**
- Consumes: Task 6's receipt payload and Task 3's fields.
- Produces: none.

- [ ] Step 1: Write failing tests:
  - "picker: IA holds counted as available";
  - "receive dialog: defect needs reason";
  - "receive dialog: per batch for batch item";
  - "label: replacement".
- [ ] Step 2: Run them. Expected: FAIL.
- [ ] Step 3: Implement.
- [ ] Step 4: Run them. Expected: PASS; an ordinary LOT is unchanged.
- [ ] Step 5: Ledger line.

### Task 11: The dev publishes

Each batch: backup, then `--dry-run`, then the user's yes (AskUserQuestion), then `--publish`, then the IDENTICAL check, then a
ledger line. Plans live in `scratchpad/iatr/deploy/wf_upload.iatr.bNN.plan.json`.

- [ ] B22: the Item Assembly Setup form, plus the LOT form fields (OFF). Check the columns' types on dev. Also the Setting page (page 1909260299874861057, `Item Assembly & BOM/Setup/SettingPage.json`, base `scratchpad/iatr/base/rr_SETTING_v87.json`): the Item Assembly Setup tile, which is how users reach the setup.
- [ ] B23: IA_HOLD v14.
- [ ] B24: LOT_V2_PREPARE, COMMIT and WORKER, then B25: LOT_V2_SUBMIT. SUBMIT goes last, so no job meets an old PREPARE.
- [ ] B26: IA_TRANSFER_REQUEST v8, then IA_SAVE v16 and IA_V2_SUBMIT v8.
- [ ] B27: the IA form, LOT form and LOT list with `RR_ENABLED` ON; the setup row turned on for 711077 (the user, in the setup
  page).

### Task 12: The live tests on dev

- [ ] Run T1–T16 of the design's section 10 on 711077 (tell 3f first), with `scratchpad/iatr/live/lt.py` and the browser.
  Each write needs the user's yes.
- [ ] Record every document number and result in the ledger.

### Task 13: The prod folder

- [ ] Rebuild `prod-hotfix/2026-10-28-ia-transfer-request/` with `scratchpad/iatr/deploy/prod_folder.py --write`:
  - every target with name, id and its base re-checked IDENTICAL against prod;
  - the setup form creation and menu step first;
  - the grants last.

  Hand it to the user.
- [ ] After the user pastes, run `prod_folder.py --after` and `python3 scratchpad/prod_health.py`.
