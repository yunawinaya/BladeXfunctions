# Picking V2 stage 1e: Auto Complete GD through the background save, desktop confirms (2026-10-27)

**Status:** LIVE on dev at 13:03; the live end-to-end test PASSED; the classic vs V2 parity test PASSED.
- **PROD: the three workflows are LIVE 10-27, verified IDENTICAL:** COMMIT v16, PREPARE v14, SUBMIT v12. They were pasted
  early because classic auto-complete broke a GD Created V2 save at Kenhin at 13:24 (GD/20261027/2168).
- No Kenhin / LSH V2 confirm fell in the paste window.
- **The Picking form is LIVE on prod 10-27 14:04** (enabled v181) and **the list page at 14:40** (enabled v75), both
  verified IDENTICAL. **Stage 1e is fully on prod.** Before the list page, Kenhin's first batch of 10 (14:07) was started by
  the GD list sweep: all Completed by 14:16.
- **Open:** LSH phone confirms stay classic until the mobile caps OTA (built by the mobile session; the with-caps server
  path passed on dev at 14:10).

## Hardening, 10-27 15:19 (dev form v439 + list page v225; prod paste pending)

**The gap (Kenhin, prod):** 13 deliveries from the 14:30 and 14:50 Auto Pick & Complete stayed Processing. Their Pickings were
done and their completions QUEUED, but nothing started them.
- After the 14:50 confirm the browser never called STATUS. The list's v75 code started the completions from the Picking
  worker's success callback.
- A working worker run takes 11-22 s. Its answer evidently never reaches the browser (the GD session saw the same on its GD list
  chain all day), or the tab still ran pre-14:40 code. Either way, a kick hung on the worker's answer is fragile.

**The fix (client only; no workflow change):**
- **The confirming screens follow the job through STATUS** (form `pkV2_onSave_Completed.js`, list `pkV2_listAutoPick.js`):
  - every 3 s, at most 50 polls;
  - each queued completion is started once (GD_COMPLETE_WORKER, one call per job), and the ones left for a manual completion
    are named once;
  - P7 adds its entries just after the job is COMPLETED, so the follow stops after 3 stable polls;
  - nothing waits on the worker's answer.
- **The Picking list sweeps** (`Picking Plan/PPonMountedListPage.js`, its mounted handler): GD_COMPLETE_WORKER `{}` (the
  tenant's due completions) on open and every minute while the list is open.
  - Throttled per browser (localStorage `pkv2_gdc_kick_at`); one beat per window; it stops when the page leaves the list.
  - An open Picking list therefore also clears any backlog, whatever page queued it.

**Evidence:**
- Tests: `test_client_1c.js` (the form follow, with the worker's answer lost), `scratchpad/pk1e/test/test_client_list.js` (the
  list follow) and `test_list_mounted.js` (the sweep and its throttle / stop) all pass. `test_client_1d.js` passes 19/19,
  including its mirror check.
- **Live on dev:** `scratchpad/pk1e/test/live_follow_dev.js` ran the list's real followGdCompletes against the dev workflows,
  with the Picking worker's answer never awaited. PI-20260929-0332 / GD/20260929/564 (4 rows):
  1. the first STATUS read COMPLETED with [GD/20260929/564 QUEUED] and started its completion;
  2. 3 stable polls followed;
  3. the GD was Completed (auto-SI), the Picking Completed and unlocked.

**Prod paste: 2 items, same as before.**
- Picking form 1935556443668959233: `PickingFullJSON.json`, on prod v181 (only eventScript 14 changes).
- Picking list page 1935635853539348481: `PickingListPageFullJSON.prod_paste.json`, on prod v75 (eventScript 1 + 24 change).
- **Open tabs keep the old code until they reload.**

**Parity test** (the GD session, dev 000000, twins GD/20260929/560 (V2) and 561 (classic), each GD's own before/after delta;
files in `scratchpad/gdc/parity_auto_complete/`):
- SAME: the GD, its lines, the reservations, the SO and its lines, item balances, batch balances, FIFO, WA, movements, the
  completion snapshot.
- DIFFER: only `item.last_transaction_date`, which V2 (C6) stamps, as classic's normal completion does, and classic's
  picking path does not. That is harmless.
- Auto-SI: SI/20261027/0173 vs 0174, the same totals and lines (only each twin's own SO number differs).

## Why

LSH (128671) turned on Picking Setup "Auto Complete GD" on prod at 12:19 MYT on 10-27 (and Packing required off). Picking V2
did not handle Auto Complete GD: SUBMIT sent such confirms to the classic save. Classic PICKING completes each delivery
synchronously, inside the picker's request, without the engine's stock locks. At LSH's volume (1,250 Pickings in 7 days)
that means slower confirms, and the classic / engine race class from 10-21..10-24.

## What changes (user's design, 10-27)

- **Desktop confirms with Auto Complete GD go V2.** These are the Picking form (`PK-` keys) and the list's Auto Pick &
  Complete (`PKA-`). Phone confirms (`PKC:` / `PKF:`) stay classic until the mobile app starts the completions itself (the
  user's choice). Loading Bay + Auto Complete GD stays refused, as classic does.
- **The phone switch is a capability, not a server change** (added 10-27 13:2x, for the OTA). An app that starts the
  completions sends `"caps": ["gd_complete"]` in its payload; the guard keeps known tokens only, and that phone goes V2.
  Phones without the cap stay classic, so an OTA reaching phones gradually is safe. The mobile side is
  `Picking/AsyncV2/MOBILE_PICKING_V2_GUIDE.md` Part 11. `PICKING_ASYNC_SUBMIT.json` here includes it: the guard and
  decide nodes, `caps` declared on the guard.
- **COMMIT P7, after P6:** the job is COMPLETED and the Picking unlocked earlier in the same run, and the run reads its own
  writes. Then each delivery on the Picking that is fully picked and still Created goes to GD Complete V2, as classic
  PICKING's GOODS_DELIVERY call does:
  - the call: `GD_COMPLETE_SUBMIT` 2110182609618337794 `{operation SUBMIT, gd_id, source PICKING, answers {needCL: "auto"},
    causation_id "PICKING|<job>"}`; at most 25 per Picking;
  - all the calls sit in one try-catch. A failed call (e.g. two Pickings of one delivery finishing together) ends the loop,
    and a fill then records every delivery left without an answer. The Picking stays saved.
  - The organization's Auto Complete GD is read at commit time (its first setup row, as SUBMIT and PREPARE read it).
- **Each answer is a step `P7|<gd>` on the Picking job:**
  - `QUEUED` with the COMPLETE_GD job. GD Complete's "already being completed" BUSY counts as the same job.
  - Otherwise `NOT_QUEUED` with the reason, "...: complete it from the Goods Delivery list" (credit limit, Packing
    required, a sibling Picking still confirming, ...).
- **STATUS** answers `gd_complete` (those steps). After the worker, the desktop screens start `GD_COMPLETE_WORKER`
  2110182645714518018 once per queued job and name the deliveries left for a manual completion. Any open GD list's
  2-minute sweep is the safety net.
- **Size:** no line cap on the Picking side; GD Complete V2's SUBMIT decides.

| Item | id | Paste file | Prod now (= base) | Dev |
|---|---|---|---|---|
| `PICKING_ASYNC_SUBMIT` | 2109531449614647297 | `PICKING_ASYNC_SUBMIT.json` | `PICKING_ASYNC_SUBMIT.base.json` | v12, identical |
| `PICKING_BULK_PREPARE` | 2109531157594619905 | `PICKING_BULK_PREPARE.json` | `PICKING_BULK_PREPARE.base.json` | v14, identical |
| `PICKING_BULK_COMMIT` | 2109531367339180034 | `PICKING_BULK_COMMIT.json` | `PICKING_BULK_COMMIT.base.json` | v17, identical |
| Picking form (`transfer_order`) | 1935556443668959233 | `PickingFullJSON.json` | v437 (`PickingFullJSON.base.json`) | v438, identical |
| Picking list page | 1935635853539348481 | `PickingListPageFullJSON.prod_paste.json` | v74 (`...prod_v74.base.json`) | v224 |

- **The list page:** prod v74 differs from dev v223 in one designer property (`columns/12/parent/primaryKey`), so the prod
  paste is prod v74 + the new Auto Pick handler. Dev v224 is dev v223 + the same handler.
- **The bases:** the three workflow bases = dev = prod as of 10-27 12:5x (with the 10-26 header re-check, un-hide and
  text-quantity patches).

**Paste order matters with confirms running: COMMIT, then PREPARE, then SUBMIT last** (SUBMIT opens the gate).
- **SUBMIT before PREPARE:** an Auto Complete desktop confirm could be queued and then refused by the old PREPARE
  (PK_NOT_SUPPORTED: FAILED, nothing written, the Picking unlocked).
- **SUBMIT or PREPARE before COMMIT:** a job could run the old COMMIT without P7. The Picking would complete without its
  deliveries being handed to GD Complete V2.
- **COMMIT first is harmless:** P7 acts only for organizations with Auto Complete GD on, and the old SUBMIT still sends
  those to classic.

The form and the list page can follow in any order; until they are in, desktop completions rely on the GD list sweep. GD
Complete V2 needs no change.

## Built by

- `scratchpad/pk1e/patch_pk1e.py <in> <out>`: base-guarded raw-text patch. Changed nodes are re-serialized, the new ones
  inserted.
  - SUBMIT: `code_node_PSdecide`, `sql_node_PSstatus`, `code_node_PSstatusRes`, `return_node_PSstatus`, the root response.
  - PREPARE: `code_node_PPplan`.
  - COMMIT: 23 new P7 nodes inside `ifBlock_TPCp6`, between `update_node_PCp6job` and `sql_node_PCback`.
- **Sources kept in step:**
  - `scratchpad/pk1d/code/submit_decide.js`, `prepare_plan.js` and `submit_status.sql` (the live copies), plus pk1c's older
    copies;
  - `scratchpad/pk1e/code/p7.js`;
  - `Picking/AsyncV2/pkV2_onSave_Completed.js` and `pkV2_listAutoPick.js`.

## Evidence

- **Unit tests:** `scratchpad/pk1e/test/test_p7.js` 14/14, and all 6 mutants are caught.
- **Built nodes:** `test_p7_nodes.js` runs the built P7 / STATUS nodes, all passed.
- **The list kick:** `test_client_list.js` passes on the new file and fails 2 checks on the committed one.
- **The form kick:** `test_client_1c.js` has new cases (STATUS read, one GD worker call per queued job, NOT_QUEUED named).
- **SUBMIT / PREPARE:** `test_submit.js` and `test_prepare_plan.js` were run on the exact built node bodies.
- **Simulator** (`scratchpad/pk1c/sim/test_flow.js`, with try-catch, a "caught error fails the caller" rule, the P7 SQL
  mocks and a GD_COMPLETE_SUBMIT stub):
  - a desktop confirm: COMPLETED, then one request, the GD Processing, `P7|5001` QUEUED, STATUS lists it;
  - a phone confirm: NOT_ELIGIBLE, nothing written;
  - a failed call: caught, the Picking saved, `NOT_QUEUED CALL_FAILED`;
  - the setup off: no request.
  - **Mutant:** with P7 moved before the job's COMPLETED write, GD Complete answers BUSY ("Its Picking is being confirmed")
    and the test fails, as it must.
- **Other suites:** every other Picking V2 suite passes. Four fail the same on the untouched bases (they predate this
  change): `test_gde_fc_prepare` (fixtures), `test_picking_wa_guard`, `test_unhide_classic`, `test_unhide_flow`.
- **The new SQL on dev (read-only, tenant 496474):** the setup gate returned empty for an org with auto off; forced on, it
  found GD/20261026/124 (Created, fully picked); the read-back and STATUS ran.
  - The comments sit inside the statement: a leading `--` is refused by the read-only checker and may be by the platform.
- **Live dev E2E, tenant 000000** (org 1123598813738675201: Auto Complete GD on, no packing). Desktop Auto Pick &
  Complete on PI-20260929-0331 / GD/20260929/563 (1 line):
  1. SUBMIT QUEUED job 2114946600570269698.
  2. One worker tick: P0 / P1 / P3 / P4, then `P7|2104751392339177474` QUEUED -> COMPLETE_GD job 2114946656606171138.
  3. STATUS `gd_complete` = [{GD/20260929/563, QUEUED, 2114946656606171138}].
  4. One GD_COMPLETE_WORKER kick: COMPLETED "Goods Delivery GD/20260929/563 completed; Sales Invoice SI/2..." (auto-SI is
     on there).
  5. The result:
     - the GD and the Picking are Completed, the Picking unlocked;
     - stock at A1-B1 went from 271 / 43 to 271 / 42;
     - the reservation went from Allocated to Delivered (open 0, delivered 1).

## Before prod

- The GD session's parity test on dev: the same GD shape auto-completed by classic vs V2.
- Optional: a browser check of the desktop kick on dev (the Picking list's Auto Pick & Complete on another 000000
  Picking, e.g. PI-20260929-0329). The screen should say "Completing GD/... in the background".

## After the paste

`.dbtools/wf --prod deployed Picking/AsyncV2/<name>.json` must say IDENTICAL for the three workflows, and
`.dbtools/form --prod status transfer_order Picking/PickingFullJSON.json` must say IDENTICAL. Then watch LSH's first desktop
confirms: P7 steps, the COMPLETE_GD jobs and the GDs Completed.
