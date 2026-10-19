# SA V2 + SC Review V2 — progress ledger (session bladexfunctions-a3)

Plan (approved 2026-10-16): `~/.claude/plans/help-me-build-stock-frolicking-knuth.md`. Memory: `project_sa_sc_v2.md`.

## LIVE TESTS 2026-10-16 21:47-21:55 (user: "Yes, prepare + run them"; DEV 496474 announced to all 8 sessions) — `live/RUNBOOK.md`
- 0a items SAV2T-FIFO 2111092118006435842 / -WA 2111092127854661634 / -FIFOB 2111092139607101441 / -ALT 2111092147412701185;
  0c batch SAV2T-B1 2111092232557072386; 0d seed APPLY OK → `seed.py --check --seeded` ALL PASSED.
- T1 (form Add → Completed, 9 entries) job 2111092455022956546 / SA/20261016/0011: 0 tables differ, 0 failed (1 tick, 2 s).
  Kit fix: `diff_twins.py` item = (touched by update_time, value after) — both twins write the same doc date, so B's write was
  invisible behind A's (`test_diff_twins.py` 29/29 after modelling update_time).
- T2 (Draft → Completed + header/line edit) job 2111093004384505858 / SA/20261016/0013: 0 / 0 (A1_SA_LINES ran).
- T3 (SC Review → SA) SC A 2111093128951140354 / B 2111093145686413313, job 2111093357544902657 / SA/20261016/0015: 0 / 0
  (sc + 8 scl SAME; steps A0 A1 A2 A3 A4).
- F1 job 2111093499123634178 FAILED SA_INVENTORY_INSUFFICIENT "line 2 (SAV2T-FIFO), bin Test-Batch-S2": NOTHING MOVED, SA
  2111093499203325954 back to Draft, no lock held.
- 2k (21:55-21:58): SC STC/20261016/0013 2111093764530802690 (2,000 lines, 704 materials; Issued save 9.0 s, count save 7.7 s),
  REVIEW job 2111093940574130178 → SA/20261016/0017 2111093940783845378 (1,166 lines; kit preview said 1,162 - it priced batch
  Ins at the newest layer of ANY batch, the real build's costFor is per batch). SUBMIT 4.8 s HTTP; ticks 5 s PREPARE → 72 s COMMIT A
  (engine 62.3 s, 14.79 MB, 2,712 lock keys = ITEM 1,968 + BATCH 40 + COST 704) → 16 s COMMIT B. Node data MB: SUBMIT 6.32,
  PREPARE 13.01, COMMIT 10.97 / 9.21. `reconcile_2k.py check` → RECONCILED (SA = approved variances, 2,000/2,000 Adjusted, Fully
  Adjusted, ib 1,968 / ibb 40 / FIFO 721 / WA 16 keys exact, 0 locks). `started_at` NULL = the whole GD-lineage worker family.
- Told: eb (numbers), all 8 sessions (plant free). Classic alt-UOM In costing (×10 per PCS on BOX lines) reproduced in BOTH twins.
- NEXT: Phase C (measure the 2k count document: browser steps are the user's; server-side no-SA Review / Sync need a yes),
  the user's browser click-through, COMMIT shell rename.

## 2026-10-19 (Mon, deployment week; this session is now bladexfunctions-fb; all peers restarted under new names)
- Checked: 6 workflows IDENTICAL, SA form v315 / SC form v499 / SA list v59 / SC list v40 IDENTICAL; no COMPLETE_SA job since the
  10-16 tests; COMMIT shell 2111074444748689410 still named SA_V2_PREPARE.
- Correction: prod alternate-UOM SA lines = 12, ALL Outs → the alt-UOM In costing bug has 0 prod exposure (I first said 1 line).
- Written: `Stock Adjustment/AsyncV2/README.md` (switches, eligibility, job conventions, locks, guard, errors, REQUIRES_REVIEW runbook,
  tests) + `Stock Count/AsyncV2/README.md`.
- Sent: mobile note → sudu-mobile-expo-15 (guard 400, whole-count saves, item_list / stock_count_no_type NULLed by mobile saves:
  prod 0/18 Issued vs 15/85 counted); final change list → all 8 other sessions.
- Still waiting on the user: browser click-through; yes for the Phase C writes (two more 2k counts on dev 496474); COMMIT rename;
  alt-UOM fix decision (no exposure, can wait). After the cut: prod SELECT checks.

## RESUMED 2026-10-16 19:14 (user: "continue and all other sessions"; all 7 told to resume)
- WP0 DONE 19:40: `CONTRACT.md` (§1-§16 + rulings; §16 = the shared review chain owned by A), `ids.json` (shells "0"),
  `code/shared/{sa_common.js, fingerprint.js, movekey.js, sql.py}` (tests: `node test/shared/test_shared.js` 35 ok;
  `python3 test/shared/fp_live.py` ok on dev; `python3 test/lib_smoke.py` ok), `build_sa.py` (dispatcher; STOCK_COUNT → Stock Count/AsyncV2).
- Guard answer shapes decided from the code: STOCK_ADJUSTMENT refusals = RETURN node {code "400", message} (the SA form reads
  data.code); STOCK_COUNT refusals = END node code 400 + msg (web handlers + mobile both show msg; Packing V2 / Putaway V2 Mobile OK'd).
- Packages dispatched 19:45 as background subagents (no publish / no DB writes): B1 guarded classics, D client (switches OFF),
  A PREPARE + shared review chain, B2 SUBMIT, C COMMIT + WORKER, E parity + race harness + 2k payloads.
  f8's lessons forwarded: A = unlock only after the lock check; D = a new doc keeps its idem key until the job is linked.
- STILL NEEDED FROM THE USER: the 4 SA_V2_* shells in the dev designer.
- Prod-only-edit check DONE 19:55 (full deployment overwrites prod with dev): SC form dev v497 = prod v490 + `allow_print_use` only;
  SC list dev v38 = prod v37 + column-7 display props only; SA list dev v57 vs prod v55: handlers identical by name (dev adds an empty
  onFormChange), the rest = dev-side display tweaks (a date column Date → Datetime, operator labels EN). SA form identical. → no prod-only
  edits to port; building on the dev bases loses nothing.

### DEV BATCH 1 PUBLISHED 2026-10-16 20:06 (user yes): the guarded classics — see `deploy/touch_list.md`
- B1 delivered (build_classic.py, code/classic, test/classic run_all.sh ALL PASSED incl. 259 interpreter checks, 14 base-vs-guarded
  parity runs, sqlcheck + sql_live on dev). Rulings applied: SA stored read = status only; SC Review cap only when the classic would
  build an SA (prep predicates + createAdjustment); sa_common.js export fixed to ONE line (include_js bug found by B1).
- 4 probes pre-publish (doTest of the new JSON) and post-publish (runwf via dev.mes): SA refusal {code "400"} / SA pass-through →
  classic "Validation Error: Adjustment Date" / SC refusal envelope {code 400, success false, msg} / SC mobile-shaped pass-through →
  classic 406 "Validation Error: Plant". Zero business writes. `wf --dev deployed` IDENTICAL: STOCK_ADJUSTMENT v25, STOCK_COUNT v11.
- Package A step 1 (shared review chain) delivered: 25 recorded STOCK_COUNT review runs byte-for-byte; adapter shapes 5,357 cells 0 failures.

### DEV BATCH 2 PUBLISHED 2026-10-16 20:11 (user yes + "I'll click through"): the client, switches OFF — see touch list
- D delivered: triggerEvent on RULE events PROVEN (platform bundle loadEvents/triggerEvent + prod PT form rule→rule runs);
  check_fallthrough.js SA 188 / SC 50 / lists 24 / JSON 189 all pass (switch-OFF call traces = base forms). Verified by me: the
  switch-OFF path is the first statement; Draft re-read + the one SC Review line are the only changes to code that runs OFF.
- Read-back: SA form v314 / SC form v498 IDENTICAL (`.dbtools/form status`), SA list v58 / SC list v39 IDENTICAL; columns
  sa_v2_job_id / sa_idem_key created (varchar 255). WAITING: the user's browser click-through.
- C delivered COMMIT (311 nodes) + WORKER (91): unit 119, COMMIT sim 1,120 (crash after every write → resume, 409 waits, 400/500,
  PARK 1,040), worker 22; validate/check_wf_js/sqlcheck clean. Rulings sent: PARK after PREPARE > 1,000 entries (A + C), A1 clean
  failure → FAILED + unlock (C), SALINES 19 cols / header 13 / list when lines OR header differ / sc_id / SC part shape (A),
  refuse id-less SC lines at SUBMIT (B2). Deferred hardening: prevStatus pairing by source (C Q8).

### 21:27 SWITCHED ON on dev (user: ship ON next week): SA form v315, SA list v59, SC form v499, SC list v40 (IDENTICAL; D's --on
build; 479 client checks). Told every session (user): full deployment = everything on dev → prod; mobile stays classic (held).
NOT YET VERIFIED LIVE (told the user): no real document through V2 end to end (package F kit → run before the cut), browser pass.

### 21:15 engine v10 + seed v5 (eb) first-use check (user yes): FIXED — loser's engine run Complete at IBbusy, 3/3 CONSISTENT, 0 locks.
eb (21:20): a child run that CAUGHT an error still surfaces to its calling workflow node as a failure → in-workflow callers get the
slow path on a first-use seed race (the COMMIT attempt dies, nothing written, the job resumes after the 10-min lease). SA V2 fine
(no change). Fast-path options (eb's user, optional): pre-seed COST rows per tenant at V2 enablement (my vote) or a per-org seed GATE.

### 20:54 SA_V2_COMMIT v4 (user yes): transient engine answers → lockWait / retry. 20:58 engine v9 first-use check (user yes):
CONSISTENT ×3, but the first concurrent use still FAILS the parent engine run (seed child failure aborts the parent) → reported to
eb + a6 (instances 2111079395239563265 / 2111079395394752513). SA V2 handles it (lockWait). Live test kit (package F) being prepared.
a6 (21:05): in-WORKFLOW callers never see that envelope — a crashed engine run fails the calling COMMIT run too; the job (lease
held) resumes after the 10-min lease. Same for SA V2 (A2 calls the engine from workflow_node_SACa2): the seed race = one dead-lease
retry (~10 min) at A2, nothing written; COMMIT v4's envelope mapping only matters for HTTP-style answers. Fine given the retry budget.

### DEV BATCH 3 PUBLISHED 2026-10-16 20:43 (user yes): SA_V2_SUBMIT / WORKER / PREPARE / COMMIT v3 (ids in ids.json) — IDENTICAL
- Shells created by the user; the COMMIT shell 2111074444748689410 is NAMED "SA_V2_PREPARE" in the designer (asked to rename).
- First publish attempt: WORKER failed "rootNode is null" (its callees were empty) → order PREPARE → COMMIT → WORKER → SUBMIT.
- Smokes (no writes): SUBMIT STATUS, WORKER IDLE, PREPARE / COMMIT bad job id → SA_INVALID_DATA. Inert in prod (switches OFF).

### ENGINE v8 RACE RE-RUN 2026-10-16 20:45-20:52 (user yes): 16/16 CONSISTENT (R0 → clean 409 on COST key; others SERIAL)
- 0 locks left held. NEW FINDING sent to eb: first concurrent use of an unseeded COST key fails one engine run at add_node_IBseed
  (duplicate Lock Key) → platform envelope {code 400, no result_code}; nothing written; 3/16. Prod: every material + plant unseeded
  at first → eb to pre-seed and/or map a failed seed to 409. Our A2: empty-code 400 → lockWait (C rework running).

### ALL PACKAGES DELIVERED 2026-10-16 ~20:45; integrated dry build OK
- A delivered SA_V2_PREPARE (66 nodes) + shared review chain: golden a 238 checks (25 recorded review runs byte-for-byte), golden b
  5,357 cells 0 failures, golden 3a 182/182 classic SA runs = 369 ADD/SUBTRACT params exact, 3b 180/180, 3c 6/6, flow 40/40; 2k
  node data 22.0 MB. Rulings: nested fork-join OK, SALINES '' / null fill OK, COMPLETE uses the DOC header, code SA_SC_UNSAVED_LINES
  (tweak running), optional: gate review-only reads for FORM jobs.
- `python3 scratchpad/sav2/build_sa.py` builds all 6 (PREPARE 66, COMMIT 320, WORKER 91, SUBMIT 117, STOCK_ADJUSTMENT 65, STOCK_COUNT
  84 nodes); validate.py 0 blocking on all 4 V2 workflows; check_wf_js 0 problems (103 scripts).
- ENGINE: bladexfunctions-eb owns the COST| patch (user already said yes in eb's session "once we got the evidence"); I review the
  diff + re-run R0-R3 after eb's dev publish (ask the user for the test-write yes first); a6 agreed (no GR / Putaway V2 change; R2
  Revert to take COST tokens later — eb to give a6 the TAKE / GIVE shape).
- Also found by A (prod, out of scope, tell the user): tenant 237197 ADJ-2609-020 was renumbered to ADJ-2609-022 when posted (Fully
  Posted) → its inventory movements keep the old number.
- ENGINE PATCH REVIEWED 2026-10-16 ~21:00 (eb's, not published): guard.js adds `COST|<mat>|<plant>` for isMovingInv !== 1 (sorted with
  ITEM/BATCH); TOKENS GIVE re-read accepts 'COST' (else COST rows would never be released); test_nodes 10/10, test_core 21/21; +~7 s on
  a 1,948-line GD. My review: OK (scope / sort / seed / filters / MAX_LOCKS 40,000 verified). Order: TOKENS v5 → engine v8. After eb's
  dev publish: user yes → re-run race R0-R3 expecting CONSISTENT.
- A tweak done: SA_SC_UNSAVED_LINES code in PREPARE; review-only reads gated by needReview (FORM jobs skip them); PREPARE 71 nodes;
  golden 238 / 5,357 cells / 182 / 180 / 6 and flow 42/42 all green.
- NEXT: user creates the 4 shells → ids.json → `build_sa.py --write` → dev batch 3 (SA_V2_* inert; switches stay OFF) → live V2 tests
  by calling SA_V2_SUBMIT directly as admin@496474 (twins, 2k) → Phase C. Batch-2 browser click-through still pending (user).

### RACE TEST DONE 2026-10-16 20:24-20:31 (user yes; DEV 496474; announced start + end to all sessions) — `race/EVIDENCE.md`
- 4 test items via ITEM_SAVE (SACRACE-FIFO 2111070303143723010, -WA 2111070325549694977, -FIFOB 2111070356172308482 batch
  2111070517371994114, -FILL 2111070363029995521); seed = classic ADD (batch) + APPLY SACRACE|SEED|1.
- CONFIRMED: R1 FIFO SUB/SUB ×2 + R2 WA ADD/ADD ×2 → LOST UPDATE (loser 500 REVIEW, locks kept); R3 FIFO ADD/ADD ×2 → DUPLICATE
  SEQUENCE (silent); R0-01 eb's interleaving → LOST UPDATE, both 200 (silent); R0-02 REVIEW (consistent by order); R0-03 409 from
  R0-02's held locks. Test locks released by approved scoped dbw (owner 'SACRACE|%'; 0 held). Evidence sent to eb + a6 with the
  COST| proposal; asked eb whether I draft the engine patch.
- C rework done (PARK after PREPARE handled by the worker; A1 clean failure → FAILED + unlock SA_LINES_WRITE_FAILED via A1_TRY row).
- B2 rework done (FORM SA with stock_count_id → SA_SC_BUSY when its SC has another Processing SA / open REVIEW / fresh SCR lock; 196 checks).

### B2 delivered 2026-10-16 ~20:30: SA_V2_SUBMIT (117 nodes, 483 KB) — `sh scratchpad/sav2/test/submit/run_all.sh`
- 184 matrix checks on the interpreter with A's REAL review chain (write orders DIRECT / Clone / COMPLETE / REVIEW, twins, BUSY /
  STALE, NOT_ELIGIBLE / TOO_BIG / SPLIT, issuedNo reuse, -9999, every gate, STATUS ×7 states + D's polls, 17 INVALID); validate /
  check_wf_js clean; sqlcheck 16 SQL nodes × 2 value sets 0 problems; 2k REVIEW 7.2-13.7 MB, 2k COMPLETE 10.5 MB.
- Rulings: -9999 keeps the typed number; extra BUSY rule (fresh foreign lock); REVIEW payload + createAdjustment / nickname /
  adjustmentDate; NOT_ELIGIBLE for 0-entry FORM / no default rule; prefix rule ORDER BY is_draft, id (A). Resumed for: FORM SA with
  stock_count_id → BUSY when its SC has another Processing SA.

### E delivered 2026-10-16 ~20:20 (read-only; `bash parity/run_all.sh <SP>/sav2-parity`)
- MOVES (CONTRACT §5 builder vs recorded classic ADD/SUBTRACT calls, field for field): prod 167/167, dev 15/15 identical.
- CALLS: prod 355 = 280 identical + 74 "remark gap" + 1 pre-v65; DOC (one APPLY per SA): prod 167 = 148 identical + 15 remark gap + 1
  pre-v65 + 3 no-entry; dev INSUFFICIENT ×2 = all-or-nothing by design. DB read-backs: 260/263 OUT rows identical (1 pre-v65, 2
  rewritten after a base-UOM change), 20 FIFO + 71 WA batch rows match.
- REMARK GAP (cosmetic, engine core.js `remarkOf`): an In on an EXISTING batch balance row whose remark is NULL stores '' (classic
  keeps NULL). Not fixed (engine change = user's call; GR V2 has it too).
- Not in SA history (engine paths rest on GR / LOT parity): Fixed Cost, FIFO shortfall, WA real-price re-average, alt UOM, finer-than-rule.
- Race harness ready, NOT run: race/{config.example.json (tenant 496474, plant 1942795438353035266, bins L1/L2), seed_plan.py,
  fire.mjs (--live), reconcile.py (58/58 fixture tests), run_series.sh}. Needs 4 dedicated test items (FIFO, WA, FIFO-batch, Fixed Cost
  filler) + seed writes + live runs — each WRITE needs a user yes; announce 496474 first. fire.mjs spawns runas.mjs (allow rule may
  not cover it).
- 2k payloads ready: live/build_sa_2k.py (2,000 entries, plans clean), live/build_review_2k.py (2,000-line SC → 1,163 SA lines).

## (history) PAUSED 2026-10-16 ~18:10 MYT (user went home; every session told to pause and stay open)

Nothing published, nothing written to any DB. Only local files in `scratchpad/sav2/` and messages to the other sessions.

### Done (WP0, partial)
- Namespace verified free on dev (0 jobs COMPLETE_SA / `SA|` / `SC|`, 0 step rows `SAC|` / `SCR|` / `SA|`) and CLAIMED with
  all 7 sessions: command `COMPLETE_SA`, correlation `SA|<saId>`, SA lock `SAC|<saId>`/`LOCK|n`, review guard
  `SCR|<scId>`/`LOCK|n`, engine op `SAC|<jobId>`, steps `A0_`..`A4_`.
- Kit copied 18:05: `lib/` = verbatim `smv2/lib` (use directly); `tpl/smv2/` = verbatim smv2 code / client / submit /
  prepare / parity / test / classic / build_*.py / CONTRACT.md (templates to adapt; never edit; md5s in `tpl/smv2.MD5`).
  The copy already holds f8's two post-v3 fixes (`code/commit/_cmp.js` numeric 16+ char compare,
  `code/shared/lot_common.js` + `fingerprint.js` lotParseJ quoting only whole 16+ digit integers).
- Bases pinned (`base/snapshot.py`, `--check` to re-verify; `base/MANIFEST.json`): STOCK_ADJUSTMENT v24 (= prod v18),
  STOCK_COUNT v10 (= prod, key order only), CHECK_REQUIRED_FIELD v8, REORDER_SET_REDIS v21 (prod v20 differs),
  GLOBAL_INVENTORY_VALIDATION v11, INVENTORY_BULK_APPLY v7 + INVENTORY_LOCK_TOKENS v4 (absent on prod), ADD v65,
  SUBTRACT v59; SA form v313 (= prod), SC form v497, SA list v57, SC list v38; schemas of the 4 tables; `columns.json`.
  Sub-table ids: SA lines 1942861580035698690 (`stock_adjustment_1dknywqh_sub`), SC lines 1978655864896823297
  (`stock_count_h4c9e1cl_sub`).

### Open before / at the cut (Tue/Wed 10-20/21)
- **Check prod-only edits** (full deployment overwrites prod with dev): SC form dev v497 vs prod v490 DIFFERS (agent said
  only `config.allow_print_use`; verify), SA list dev v57 vs prod v55 DIFFERS, SC list dev v38 vs prod v37 DIFFERS.
- STOCK_ADJUSTMENT has a stale `designing` row v12 (not live) — a wf_upload targets the enabled base; mention to the user.
- **User:** create the 4 dev shells (Save Workflow / Stock Adjustment): SA_V2_SUBMIT, SA_V2_WORKER, SA_V2_PREPARE,
  SA_V2_COMMIT → `ids.json` (not written yet).

### Next (resume here)
1. `ids.json` + `test/lib_smoke.py` (copies == `tpl/smv2.MD5`), then de-LOT list (plan: worker `_common.js:63` prevStatus
   set, `:90` unlock column, PREPARE entry, COMMIT failNoWrite, `build_commit.py:123,126`, `submit_sql.py:127,132`
   offset 5 / `SMLT|`; steps regex `^A[0-9]_`).
2. `CONTRACT.md` (smv2's as template) incorporating the plan + the reviewer's A1-A12 fixes + the peer constraints below.
3. B (guarded classics) + D-OFF (forms / lists, switches OFF, Draft re-read, status filter, Post button) with the
   switch-OFF regression → dev publish batch (yes first). Then A / C / E in parallel; race R1-R3 (yes first).

### Peer constraints received (2026-10-16)
- **f8:** copy fixes (done). A list bulk action must apply the form's size threshold and fall back to the classic on a
  transport failure (we add no bulk action).
- **eb (GD Completed V2):** agrees the cost gap is real (hits GD V2 too). COST| fix conditions: same sorted lock order as
  ITEM/BATCH, one key per material + plant; only isMovingInv 0 on FIFO/WA; INVENTORY_LOCK_TOKENS BALANCE_TYPE_INVALID
  path must accept it; before publish: 7,489-call replay byte-identical + `scratchpad/gdc/engine/test_core.js` + eb's
  commit_sim / test_hu / test_c2_lock + a live completion re-run (eb helps). Yes needed from eb, a6, me and the user.
  Race test MUST include the silent interleaving: B (large op) reads → A (small op) writes + reads back DONE → B writes
  stale absolutes → both DONE.
- **a6 (GR / Putaway V2):** consumer, not engine owner (engine was bladexfunctions-8a's, gone; engine changes = the user's
  call). GR V2 GRN ADDs (isMovingInv 0) have the same exposure — FIFO ADD/ADD + WA ADD/ADD are GR's shape; COST keys
  derived INSIDE APPLY means GR V2 needs no change. GR Revert V2's R2 writes cost rows itself with expected-before checks
  at plan time only (update WHERE not enforced) → a narrow lost-update window too; an engine COST lock won't cover R2.
- **GD Edit & Picking V2:** no overlap; Picking V2 engine op `PKM|` ships ON; on a clash the engine 409 makes Picking wait
  15/30/60/120 s then fail clean. Tenant 496474 free for our tests (announce first).
- **Putaway V2 Mobile:** mobile parses top-level `code 400` + `msg` (normalizeWorkflowResult); other codes show "Unknown
  workflow status". → the STOCK_COUNT guard must refuse via an END node (code 400 + msg → envelope {code 400, success
  false, data null, msg}), not a return node. Check the web SC handlers read that envelope too. Owe them the Phase C
  hand-off (whole-SC save, NULLed item_list / stock_count_no_type, object pageStatus).
