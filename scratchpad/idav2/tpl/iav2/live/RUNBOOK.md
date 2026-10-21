# Item Assembly V2 - live-check runbook (package E, DEV, Tue 2026-10-20)

Every step marked **WRITE** is run by the controller only, one batch at a time, after the user's yes (one yes per batch). Everything
else is read-only (SELECTs through `.dbtools/db --dev`) or local (node / python on files). The kit never calls the platform itself:
`cmds.py` only PRINTS the literal run command, which the controller runs as its own shell call (the runas allow rule of skill
running-dev-workflows-as-tenant matches nothing chained). Plan: `~/.claude/plans/cheeky-shimmying-puffin.md` ("Verification" 1-12);
contract: `scratchpad/iav2/CONTRACT.md` (it wins over this file).

**Tenants.** 711077 (Test Mosca / HQ, plant 2105200506810306561, admin@711077) is -41's GD test tenant: never pick "blade, loose"
2105492637718319110 at bin A1-01 2106278340907413505 (the builder drops / refuses it), never deliver / edit / cancel SO/20261016-034 /
-035; tell -41 before and after the 711077 window (its GD tests share the same A1-01 stock - every 711077 balance sits in that one bin).
000000 (ASAI / ASAI HQ, plant 1123598813738675202, admin@000000) holds the batch parents and the live SQL Accounting V2 agent.

**Prerequisites.** Batch 1 live (form + list with the switches OFF, IA_SAVE v12, IA_REVERT v5); batch 2 live (IA_V2_* and
IA_REVERT_V2_* shells published) and their ids in `scratchpad/iav2/ids.json` (`cmds.py` refuses a V2 command while its id is "0";
SUBMIT / WORKER calls below are made directly, as the client would - the switches matter only for the browser items 9 and 12).

**Data facts the expectations rest on (read 2026-10-19).** 711077: 6,024 FIFO materials, all in A1-01, no WA, no HU, no duplicate
balance key; 6,018 of 6,023 materials' FIRST FIFO layer costs 0, so every 711077 receipt prices at 0 (+ assembly_cost) - its price
check is trivially true; the price formula's teeth are the 000000 runs (layers at 80 / 12) and the replay over prod's 63 receipts.
The 830-component BOM 2105498079022452744 holds NO DL / IDL / VO line (the 829-component BOM 2105498122743877647 holds them), so
subject `a` appends I-DL / I-IDL / I-VO by Batch Add (833 lines, 830 picks = the CONTRACT section 3 example). 000000 has no BOM above
3 lines and no BOM for the three batch parents (their components are Batch-Add lines). No 711077 BOM has 200-249 lines.

## Shell

From the repo root, every shell call (READ-ONLY commands only):
```sh
export IA_LIVE_OUT=<the controller's session scratchpad>/iav2-live      # outside the repo; request bodies + dev snapshots
. scratchpad/iav2/live/env.sh                                          # K F S RP T711 T000
```
Runners: `cmds.py` prints the minted-token route (`scratchpad/gdc/tools/runas.mjs` + `id711077.json` / `id000000.json`, POST
https://dev.mes.sudu.ai/api/su-code-workflow/workflow/run/<id>, the STORED version) for both tenants. Tenant 000000 can equally go
through `node scratchpad/gdc/tools/runwf.mjs <workflowId> <request.json> <out.json>` (the CLI session, junaxanto@000000, same gateway;
create_user is then junaxanto). Both answer HTTP 200 even when the workflow refused: the result is `data` (`cmds.py ans`).
PROD captures (recorded runs, rows, number rules, prod replay results) live ONLY in
`/Users/yunawinaya/Documents/ASC-dev/iav2-fixtures/e/` (`ialib.PROD_FIXTURES`; every prod writer refuses any other path); re-pull
them read-only with `bash $K/pull_prod_fixtures.sh`. Read an answer: `python3 $K/cmds.py ans <file.out.json>`.

## Kit (scratchpad/iav2/live/, package E)

| File | What |
|---|---|
| `config.json` | tenants (org, plant, IA numbering rule, identity), the subjects, budgets (CONTRACT section 14) |
| `ialib.py` | read-only SELECTs, the client db API shapes, NOT_RECORD + the idempotency key (JS-exact), PROD_FIXTURES + guards |
| `build_ia_payload.py` | deliverable 1: the IA_SAVE request in the dev web form v32 shape + the IA_V2_SUBMIT / STATUS requests, plan.json (picks vs today's available, eligibility, expected movements, FIFO price preview); subjects `a a2 b r1 c-fifo c-wa c-blocked c-manual c-post s-ns m250 d`, `edit` (a stored Draft / `--clone`), `check` |
| `variant.py` | local variants for the negative tests: `no-picks` (401), `over` (402 / FAILED short stock), `qty N` (the second click), `gen`, `big N` (> 250 picks) |
| `plan_ia.js` | the REAL engine planner over a snapshot: op 1 then op 2 at V2's price - the expected rows, or the refusal PREPARE would give |
| `snap_ia.py` / `diff_twins_ia.py` | deliverable 2: snapshot what an IA touches; twin delta diff (masks, deliberate differences, `--expect`, `--nothing-moved`) |
| `recon_ia.py` | deliverable 3: reconcile a V2-completed IA (`--classic`: a classic one; `revert`: a V2 / classic revert) |
| `fetch_runs_ia.py` `fetch_db_rows_ia.py` `fetch_rules_ia.py` `replay_ia.js` `ia_moves.js` `run_replay.sh` `pull_prod_fixtures.sh` | deliverable 1b: twins by replay through `scratchpad/gdc/engine/core.js` (required read-only) |
| `cmds.py` | prints the exact runas command of each WRITE step; writes the revert requests; reads answers |
| `tick_ia.sh` | **WRITE**: IA_V2_WORKER / IA_REVERT_V2_WORKER kicks for one job until terminal |
| `runs_ia.py` | read-only: the latest runs of a workflow (status, seconds, MB nodes_data / request / response) |
| `test_kit.py` | offline + read-only tests of the kit (23 checks) |

Offline status (2026-10-19 16:50): `python3 $K/test_kit.py` 23/23. `bash $K/run_replay.sh $RP --replay-only`: prod 75 IA runs -> MOVES
63/63, CALLS 209/209, DOC 63/63 identical (0 DIFF; 12 refused before any movement); dev 19 runs -> 0 DIFF (3 calls / 2 runs = known
crashes of the first test runs, 1 pre-v65 run); self-test: FIFO / batch / sequence / price mutations caught, all 9 builder mutations
caught; the WA and number-rule mutations NOT caught (no WA item and no value the rules round in the recorded IA corpus: WA parity rests
on the SA replay + the live c-wa run).

---------------------------------------------------------------------------------------------------------------------------
## Step 0 - pre-flight (read-only)
```sh
python3 scratchpad/iav2/base/snapshot.py --check                       # dev moved since WP0's bases? (expect ok, or only the batch-1/2 publishes)
for w in IA_SAVE IA_REVERT IA_V2_SUBMIT IA_V2_WORKER IA_V2_PREPARE IA_V2_COMMIT; do .dbtools/wf --dev deployed "Item Assembly & BOM/AsyncV2/$w.json"; done
python3 $K/build_ia_payload.py check --tenant 711077                   # no open COMPLETE_IA / REVERT_IA job, no Processing IA
python3 $K/build_ia_payload.py check --tenant 000000
python3 $K/test_kit.py                                                 # 23/23
bash $K/run_replay.sh $RP                                              # re-pulls prod (PROD_FIXTURES) + dev ($RP): expect 0 DIFF
```
Expect IDENTICAL for every deployed file, exit 0 everywhere. Announce the 711077 window to -41.
Build every subject RIGHT BEFORE its test (the picks are today's balances): `python3 $K/build_ia_payload.py <subject>` (exit 1 = a
check failed: read the FAIL lines; never run a request whose build failed). Snapshots: `$S/<tag>.<n>.json`.

---------------------------------------------------------------------------------------------------------------------------
## 1 - Classic regression on IA_SAVE v12 (switch OFF), tenant 000000, subject r1 (TES500 + 2 FIFO components)
```sh
python3 $K/build_ia_payload.py r1
python3 $K/variant.py r1 no-picks ; python3 $K/variant.py r1 over ; python3 $K/variant.py r1 big 251
python3 $K/snap_ia.py --tenant 000000 --request $F/r1/classic.json --out $S/r1.0.json
python3 $K/cmds.py classic r1-no-picks     # run the printed line: expect data.code "401" "Line 1 (...): no stock has been allocated."
python3 $K/cmds.py classic r1-over         # expect "402" "Insufficient stock for item ... Available: <n>, Requested: <n+1>"
python3 $K/cmds.py classic r1-big          # expect "400" "This Item Assembly has 251 stock picks; this save can process at most 250 at once. ..."
python3 $K/cmds.py classic r1              # WRITE (Add -> Completed): expect "200" "Item Assembly saved." id [<r1 id>]
python3 $K/recon_ia.py <r1 id> --tenant 000000 --classic --before $S/r1.0.json      # RECONCILED
python3 $K/cmds.py draft r1                # WRITE (Add -> Draft, a 2nd IA): expect "200", id [<draft id>]; no movement (snap: mv 0)
python3 $K/build_ia_payload.py edit --tenant 000000 --ia <draft id> --tag r1-edit
python3 $K/cmds.py classic r1-edit         # WRITE (Draft -> Completed, Edit): expect "200"; then recon --classic on <draft id>
python3 $K/build_ia_payload.py edit --tenant 000000 --ia <r1 id> --tag r1-done
python3 $K/cmds.py draft r1-done           # stale-tab Draft on a Completed IA: v12 409 "This Item Assembly is already Completed and cannot be saved again."
python3 $K/cmds.py classic r1-done         # Completed again: 409 (code_idem_guard, same text)
bash $K/run_replay.sh $RP                  # the new dev runs: MOVES / CALLS / DOC identical (v12's movements = the engine's = v11's)
```
Writes: 3 IAs (2 Completed, the Draft one completed by Edit) + 2 + 2 lines, their movements / FIFO / balances on the 2 components and
TES500, the classic's blank Batch row per completion (non-batch parent), item dates. The refusals (401 / 402 / 400 / 409) write
nothing: `snap_ia.py` before / after shows no change. Expect = the v11 answers (texts above, from v11 + CONTRACT section 11) and the
recon / replay pass. Clean-up: none needed (2 x qty 1 of TES500); or revert by the classic (step 8c form).

## 2 - Guards (v12): a classic save of a Processing IA -> 400; a stale-tab Draft on a Completed IA -> 409 (done in 1)
Run inside item 5: after `cmds.py submit c-fifo` answered QUEUED and BEFORE the first tick (the IA is Processing):
```sh
python3 $K/build_ia_payload.py edit --tenant 000000 --ia <c-fifo ia_id> --tag c-fifo-busy     # warns: stored Processing
python3 $K/snap_ia.py --tenant 000000 --ia <c-fifo ia_id> --out $S/busy.0.json
python3 $K/cmds.py draft c-fifo-busy       # expect "400" "This Item Assembly is being processed in the background - please wait for it to finish."
python3 $K/cmds.py classic c-fifo-busy     # same 400
python3 $K/cmds.py edit-submit c-fifo-busy # V2: BUSY 409 IA_BUSY (stored Processing / open job)
python3 $K/snap_ia.py --tenant 000000 --ia <c-fifo ia_id> --base $S/busy.0.json --out $S/busy.1.json   # ia / ial / mv unchanged
```

## 3 - Twins in 711077 (subject b: the first 60-80-line BOM, base UOM, FIFO, both twins priced from one FIFO layer per component)
Today: BOM 2105497491010392071 (61 lines), parent 2801-038200-00. Live twins on shared FIFO stock can only match when each component's
two issues price from the same layer; the builder picks such a BOM, and `plan.json` `fifo_price_preview.n_multi` must be 0.
```sh
python3 $K/build_ia_payload.py b                                        # availability checked for TWO runs
python3 $K/snap_ia.py --tenant 711077 --request $F/b/classic.json --out $S/b.A0.json
node $K/plan_ia.js $F/b/classic.json $S/b.A0.json                       # PLAN OK: 61 OUT + R1 (both twins' expected rows)
python3 $K/cmds.py classic b                                            # WRITE (A = classic): "200", id [<A id>]
python3 $K/snap_ia.py --tenant 711077 --ia <A id> --base $S/b.A0.json --out $S/b.A1.json
python3 $K/snap_ia.py --tenant 711077 --request $F/b/submit.json --out $S/b.B0.json
python3 $K/cmds.py submit b                                             # WRITE (B = V2): QUEUED, job_id, ia_id, ia_no
python3 $K/cmds.py tick b --job <job>                                   # WRITES: expect 1 tick -> COMPLETED
python3 $K/cmds.py status b                                             # STATUS (no write): COMPLETED, terminal YES
python3 $K/snap_ia.py --tenant 711077 --ia <B id> --base $S/b.B0.json --job <job> --out $S/b.B1.json
python3 $K/diff_twins_ia.py $S/b.A0.json $S/b.A1.json $S/b.B0.json $S/b.B1.json --expect $F/b/plan.json --json $S/b.diff.json
python3 $K/recon_ia.py <B id> --tenant 711077 --before $S/b.B0.json     # V2 by formula: RECONCILED
python3 $K/recon_ia.py <A id> --tenant 711077 --classic --before $S/b.A0.json
bash $K/run_replay.sh $RP                                               # twin A's recorded calls replayed as op 1 + op 2: identical
```
Expect: `tables differing: 0; failed checks: 0`; DELIBERATE: A's blank Batch row; FOREIGN lines name any other session's movement in
a window (then a balance DIFFER is theirs - re-check with `recon_ia.py --before`). Per twin: 1 IA + 61 lines, 61 OUT + 1 IN, 61
balance -qty / 1 +1, 61 FIFO consumptions + 1 new parent layer, 62 item stamps; B adds the job, IAC|<B> LOCK|1, P| parts, I0-I4, the
two engine operations, keyed movements. If `n_multi` > 0 the BOM cannot twin by equal prices: add `--mask-prices` to the diff and rely
on recon (B) + the replay (A). Clean-up: none (qty 1 each); B can be reverted in 8b's form (62 live rows > 50 -> V2).

## 4 - The 830-component BOM (subject a: 833 lines, 830 picks + I-DL / I-IDL / I-VO) via V2
```sh
python3 $K/build_ia_payload.py a
python3 $K/snap_ia.py --tenant 711077 --request $F/a/submit.json --out $S/a.0.json        # KEEP: the before-completion snapshot (8b)
node $K/plan_ia.js $F/a/submit.json $S/a.0.json                                           # PLAN OK, OUT total 0 (zero-cost layers)
python3 $K/cmds.py classic a              # the classic refuses it: "400" "... has 830 stock picks; this save can process at most 250 at once..."
python3 $K/cmds.py submit a               # WRITE: QUEUED (SUBMIT ~1.1 MB request)
python3 $K/cmds.py tick a --job <job>     # WRITES: PREPARE -> COMMIT A (op 1, 830 movements) -> SPLIT -> B (op 2, items, Completed); 1-2 ticks
python3 $K/cmds.py status a
python3 $K/recon_ia.py <ia_id> --tenant 711077 --before $S/a.0.json --json $S/a.recon.json
python3 $K/runs_ia.py IA_V2_SUBMIT --tenant 711077 --like <idempotency key from a/submit.json> -n 3
```
Expect: RECONCILED - 830 OUT rows keyed IAC|<job>|I|M1..M830 = the stored picks, no movement of the 3 non-stock items, request
nonStockLines 3 / pickCount 830 / movementCount 831, R1 at q8(0 / 1 + assembly_cost), the parent's new FIFO layer, no Batch row, every
touched key = its movement history, 0 locks held, 834 items stamped; runs: SUBMIT <= 15 MB, PREPARE <= 25, COMMIT <= 20, one tick
<= ~35 MB (the dev crashes began near 60 MB); timings = job queued_at -> finished_at + the run seconds recon prints. Writes: 1 IA +
833 lines, 831 movements, 830 balance / FIFO updates, 1 new layer + balance, ~834 item stamps, the job + steps + 2 engine operations.
Clean-up: revert it by Revert V2 (8b) - never by the classic (8a shows it refuses).

## 5 - Batch parents (tenant 000000; V2 called directly - SUBMIT does not enforce the 50-pick threshold)
For each of `c-fifo` (ITM-20260600005-A, FIFO, system batch, qty 2), `c-wa` (FRESH FJORD TROUT; SUP 5-6KG, WA, system batch, qty 2),
`c-blocked` (ITM-20260600005-A received Blocked):
```sh
python3 $K/build_ia_payload.py <s>
python3 $K/snap_ia.py --tenant 000000 --request $F/<s>/submit.json --out $S/<s>.0.json    # KEEP for 8c
node $K/plan_ia.js $F/<s>/submit.json $S/<s>.0.json          # receipt on a placeholder batch (I1's), priced from layers 80 / 12
python3 $K/cmds.py submit <s>                                # WRITE: SUBMIT runs GENERATE_BATCH (a batch number is consumed)
#   c-fifo only: item 2's guard checks HERE (before the tick)
python3 $K/cmds.py tick <s> --job <job>                      # WRITES
python3 $K/recon_ia.py <ia_id> --tenant 000000 --before $S/<s>.0.json
python3 $K/runs_ia.py GENERATE_BATCH --tenant 000000 -n 2     # the generated number (Batch-000nn, config 2062365526375706626)
```
Expect: one Batch row with transaction_no = the IA number, batch_number = header batch_no, initial_quantity = the receipt base qty,
= I1's batch_id = R1's batch; I1_BATCH + I1|I|001 DONE; c-fifo a new FIFO layer of that batch at the price, c-wa a NEW WA row for
that batch (not a re-average), c-blocked R1 category Blocked (block_qty +qty; the recon ledger + R1 checks).
`c-manual` (JN-MANUAL-02, Fixed Cost, Manual Input; batch_no = TWA-1015-01, a live batch of this item made by GR/202610150002):
```sh
python3 $K/build_ia_payload.py c-manual                      # expects SUBMIT NOT_ELIGIBLE 'manual batch number'
python3 $K/cmds.py submit c-manual                           # NOT_ELIGIBLE 300 reason "manual batch number": nothing written
.dbtools/db --dev "SELECT CAST(id AS CHAR) id, batch_number, transaction_no, is_deleted FROM batch WHERE tenant_id = '000000' AND material_id = 2084165274322399234 AND batch_number = 'TWA-1015-01'"
python3 $K/cmds.py classic c-manual                          # WRITE (the classic, as the client falls back): "200", id [<m id>]
#   the same SELECT: is TWA-1015-01 REUSED (still one row, the IN movement's batch_number_id = it) or a 2nd row (transaction_no = IA no)?
python3 $K/recon_ia.py <m id> --tenant 000000 --classic       # R1 at purchase_unit_price (Fixed Cost)
python3 $K/cmds.py revert-classic c-manual --ia <m id>       # WRITE (classic IA_REVERT): "200" "Item Assembly reverted to Draft successfully."
#   the same SELECT again: the GR's TWA-1015-01 row must still be live (is_deleted 0)
```

## 6 - Labour / overhead (non-stock) lines
Small classic: `s-ns` (711077, 3 stocked components + I-DL / I-IDL / I-VO, 3 picks):
```sh
python3 $K/build_ia_payload.py s-ns
python3 $K/snap_ia.py --tenant 711077 --request $F/s-ns/classic.json --out $S/s-ns.0.json
python3 $K/cmds.py classic s-ns          # WRITE: "200" (v12's code_validate non-stock rule; v11 answered 401 "no stock has been allocated")
python3 $K/recon_ia.py <id> --tenant 711077 --classic --before $S/s-ns.0.json
.dbtools/db --dev "SELECT COUNT(*) n FROM sm_item_assembly_tlm8ve69_sub WHERE tenant_id = '711077' AND sm_item_assembly_id = <id> AND is_deleted = 0 AND total_quantity <= 0"
```
Big V2 = item 4 (its recon checks the 3 non-stock lines). Expect: no movement of a stock_control-0 item, the receipt price from the
OUT rows only, every line total_quantity > 0 (the posting fetch's precondition: the SELECT gives 0). `a2` (the 829-line BOM with its
own I-DL / I-IDL / I-VO) is the optional third case (same commands as item 4 with `a2`).

## 7 - Failure: short stock -> FAILED, nothing moved, IA back to Draft; a second click works (000000, c-fifo)
```sh
python3 $K/build_ia_payload.py c-fifo --tag f7 ; python3 $K/variant.py f7 over     # the first pick = available + 1
python3 $K/snap_ia.py --tenant 000000 --request $F/f7-over/submit.json --out $S/f7.0.json
node $K/plan_ia.js $F/f7-over/submit.json $S/f7.0.json      # PLAN REFUSED op 1 INSUFFICIENT at M1
python3 $K/cmds.py submit f7-over                           # WRITE: QUEUED (SUBMIT does not check stock; it writes the IA + generates a batch number)
python3 $K/cmds.py tick f7-over --job <job>                 # WRITES: expect 1 tick -> FAILED IA_INVENTORY_INSUFFICIENT
python3 $K/cmds.py status f7-over                           # FAILED, error_message "Insufficient quantity - line 1 (<code>), bin <bin> (Unrestricted): ..."
python3 $K/snap_ia.py --tenant 000000 --ia <ia_id> --base $S/f7.0.json --job <job> --out $S/f7.1.json
python3 $K/diff_twins_ia.py --nothing-moved $S/f7.0.json $S/f7.1.json --code IA_INVENTORY_INSUFFICIENT     # NOTHING MOVED
python3 $K/build_ia_payload.py edit --tenant 000000 --ia <ia_id> --tag f7-edit       # the stored Draft (still the over-qty pick)
python3 $K/variant.py f7-edit qty 1 --gen 2                                          # the corrected line, the next key generation
python3 $K/cmds.py submit f7-edit-qty                       # WRITE: QUEUED (Edit of the Draft)
python3 $K/cmds.py tick f7-edit-qty --job <job2>            # WRITES -> COMPLETED
python3 $K/recon_ia.py <ia_id> --tenant 000000 --job <job2>
```
Note: PREPARE refuses before I1 runs, so no Batch row is ever inserted here; the plan's "Batch row soft-deleted" path (I2 refused
after I1) cannot be staged live (it needs the stock to vanish between PREPARE and I2) - C's interpreter sims cover it.

## 8 - Revert
8a The classic v5 guard on the 830 IA (BEFORE 8b): `python3 $K/cmds.py revert-classic a --ia <a ia_id>` -> "400" "This Item Assembly
has 831 stock rows; this revert can process at most 250 at once. Revert it from the Item Assembly list if background revert is
switched on, or contact support.", nothing written.
8b Revert V2 of the 830 IA (the list routing: 831 live rows > 50):
```sh
python3 $K/cmds.py revert-v2 a --ia <a ia_id>             # writes the RV4 request; WRITE: QUEUED REVERT_IA job
python3 $K/cmds.py tick a --job <rv job> --revert          # WRITES -> COMPLETED (V0 V1 [SPLIT] V2 V3 V4)
python3 $K/recon_ia.py revert <a ia_id> --tenant 711077 --before $S/a.0.json        # vs the BEFORE-COMPLETION snapshot
```
Expect: Draft, number kept, posted_status blank; 831 IA-R rows keyed IAV|<job>|M<n> (one reverse per IA row); stock back to a.0 + other
sessions' window movements; the parent's layer gone; IAV|<job> and IAV|<job>|C locks released; node data within budget.
8c A V2-completed small IA reverted by the classic: c-fifo after item 5 (4 live rows <= 50 -> the list's classic):
`python3 $K/cmds.py revert-classic c-fifo --ia <id>` (WRITE: "200") then
`python3 $K/recon_ia.py revert <id> --tenant 000000 --classic --before $S/c-fifo.0.json` (Draft, stock back, layer and Batch row gone).
8d The classic IA_REVERT measured at ~241 rows (`m250`: 240 Batch-Add lines; no 711077 BOM has 200-249 lines):
```sh
python3 $K/build_ia_payload.py m250 && python3 $K/snap_ia.py --tenant 711077 --request $F/m250/submit.json --out $S/m250.0.json
python3 $K/cmds.py submit m250 ; python3 $K/cmds.py tick m250 --job <job>        # WRITES: V2 completion (240 > 50)
python3 $K/recon_ia.py <id> --tenant 711077 --before $S/m250.0.json
python3 $K/cmds.py revert-classic m250 --ia <id>                                # WRITE: the measurement run (241 live rows <= 250)
python3 $K/runs_ia.py IA_REVERT --tenant 711077 -n 1                             # seconds + MB nodes_data / request / response
python3 $K/recon_ia.py revert <id> --tenant 711077 --classic --before $S/m250.0.json
```
Success: data.code "200" "Item Assembly reverted to Draft successfully.", run status Complete, nodes_data well under the ~60 MB crash
zone (<= ~35 MB), recon RECONCILED; record the seconds (the classic makes one child call per live row: ~150-260 ms each on prod, so
~40-60 s expected) - that number decides whether 250 is a safe classic cap.

## 9 - Complete & Post in tenant 000000 (browser; posts into the dev accounting DB - the user's yes first)
000000 has no BOM above 3 lines and the client routes V2 only above 50 picks: first the user creates (BOM form) a default BOM for TES500
with the 55 components of `$F/c-post/plan.json` (`picks[].code`, qty 1 each; `python3 $K/build_ia_payload.py c-post` re-checks
them), or uses Batch Add with them. Switch ON on dev (D's client publish with `--on`, COMPLETE_POST ON). Then, in the browser as a
000000 user: Item Assembly -> Add, plant ASAI HQ, parent TES500, qty 1 (explode + allocate), **Completed & Post**. Read-back:
```sh
.dbtools/db --dev "SELECT CAST(id AS CHAR) id, job_status, DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:%s') fin FROM gd_async_job WHERE tenant_id = '000000' AND command = 'COMPLETE_IA' ORDER BY id DESC LIMIT 1"
python3 $K/runs_ia.py ACC_PRODUCER --tenant 000000 --like <ia_id> -n 3       # the post's run: its id time must be AFTER the job's finished_at
.dbtools/db --dev "SELECT stock_movement_no, item_assembly_status, posted_status FROM sm_item_assembly WHERE tenant_id = '000000' AND id = <ia_id>"
python3 $K/recon_ia.py <ia_id> --tenant 000000 --posted
```
Expect: the post starts only after COMPLETED (ACC_PRODUCER run after finished_at; DB clock = MYT on dev), posted_status Pending Post
-> Fully Posted. If the 420 s wait ends first: "Still completing in the background; post it from the list once it shows Completed."
and no ACC_PRODUCER run until the user posts from the list. Never Complete & Post `d` / `m250` (> 1,000 items for d).

## 10 - BUSY, double click, lock waits
```sh
python3 $K/build_ia_payload.py c-fifo --tag k1
python3 $K/cmds.py submit k1 ; python3 $K/cmds.py submit k1      # WRITE once: the 2nd answers route STATUS with the SAME job_id
.dbtools/db --dev "SELECT COUNT(*) n FROM gd_async_job WHERE tenant_id = '000000' AND idempotency_key = '<key of k1>'"      # 1
python3 $K/build_ia_payload.py edit --tenant 000000 --ia <k1 ia_id> --tag k1-busy && python3 $K/cmds.py edit-submit k1-busy
#   BUSY 409 IA_BUSY (another key, the IA Processing / its job open) - nothing written
python3 $K/cmds.py tick k1 --job <job>
```
Lock waits: two V2 jobs on the same component balance. Build `python3 $K/build_ia_payload.py c-fifo --tag k2` and `--tag k3` (the
same components), `cmds.py submit k2` / `submit k3`, then start BOTH tick loops at the same moment in two background shells. Expect
both COMPLETED; the later one's job shows progress_message IA_LOCK_WAIT for a while (the engine's 409 -> lockWait 15 s x 2^n) - if they
did not overlap, repeat with `d` running (its 2,000-movement op 1 holds the locks longest) and a 711077 manual IA on one of d's items
(`build_ia_payload.py s-ns --tag k4 --components <an item of $F/d/plan.json>`). Against another session's engine (GD V2 -41, SA V2
-fb, LOT V2 -39): only by arrangement with them; same read-back (`recon_ia.py` on ours, their job rows).

## 11 - 2,000 picks (subject d: 2,000 distinct FIFO items, one pick each; NEVER post it)
```sh
python3 $K/build_ia_payload.py d
python3 $K/snap_ia.py --tenant 711077 --request $F/d/submit.json --out $S/d.0.json
node $K/plan_ia.js $F/d/submit.json $S/d.0.json
python3 $K/cmds.py submit d                     # WRITE: QUEUED (request ~2.6 MB)
python3 $K/cmds.py tick d --job <job>           # WRITES: >= 3 ticks (PREPARE + COMMIT A -> PARK above 1,000; then B)
python3 $K/recon_ia.py <ia_id> --tenant 711077 --before $S/d.0.json --json $S/d.recon.json
```
Expect: RECONCILED with 2,000 OUT rows; the run table shows PARK after COMMIT A and every run within budget (the point of the test).
Clean-up: optional Revert V2 (2,001 live rows: PARK after V1) + `recon_ia.py revert ... --before $S/d.0.json`.

## 12 - The client at 830 lines (the user's browser, tenant 711077, after the switch publish)
1. Item Assembly -> Add; plant HQ; parent `2783-000000-00` (BOM 2105498079022452744); qty 1 -> time the BOM explode + auto-allocate
   (until the 830 rows show their stock summaries; no "Not enough loose stock" warning expected).
2. Batch Add I-DL, I-IDL, I-VO; type qty 1 on each -> total_quantity 1, no stock summary, Transfer Stock disabled (the non-stock rule).
3. **Save as Draft** (classic, Draft never goes V2) -> time to the success message; the list shows the Draft.
4. Reopen the Draft (Edit) -> time the form load; **Completed** -> V2 (830 > 50 picks): time to "completing in the background", the
   follow loop, the verdict. Read-back: `python3 $K/recon_ia.py <ia_id> --tenant 711077` (+ `--before` a snapshot taken before step 4).
Record the four timings; fix only what blocks (plan). Clean-up: Revert V2 (8b's commands with this IA).

---------------------------------------------------------------------------------------------------------------------------
## If something goes wrong
- A classic answer other than the one expected: stop; read `python3 $K/runs_ia.py IA_SAVE --tenant <T> -n 1` and `.dbtools/wf --dev trace <id>`.
  The classic is not atomic: after a mid-loop failure the IA is already Completed with part of its stock moved (snapshot it first).
- A V2 job FAILED where it should not: nothing moved (phase A) and the IA is back to Draft; read `error_code` / `error_message`, the
  worker answers in `$F/<tag>/worker.<job>.tick*.out.json`, then trace the PREPARE / COMMIT runs (`runs_ia.py IA_V2_COMMIT --like <job>`).
- REQUIRES_REVIEW: do NOT re-kick. CONTRACT section 9 runbook (op 1 vs op 2 under review, the IBA|REVIEW rows of IAC|<job>|I / |R) is
  the controller's call; the IA stays Processing and the engine keeps its locks (they block GD / GR / SA / Putaway V2 on those items).
- A snapshot shows a lock held (`snap_ia.py` prints it): find its owner (`owner_operation_id`) before going on.
- `diff_twins_ia.py` DIFFER: the printed key + columns are the finding; FOREIGN lines name other sessions' movements in the window.

## Write count (if every item runs)
1: 4 IA_SAVE writes (+4 refusals) - 2: 0 (3 refusals) - 3: 2 + 1 tick - 4: 1 + 1-2 ticks - 5: 3 SUBMIT + 3 ticks, c-manual 1 classic + 1
revert - 6: 1 - 7: 2 SUBMIT + 2 ticks - 8: 3 reverts (+1 refusal) + 1 SUBMIT + ticks - 9: browser - 10: 3-4 SUBMIT + ticks - 11: 1 + >= 3
ticks - 12: browser. STATUS calls and refusals write nothing. Everything lands on 711077 A1-01 stock (the subjects' items, qty 1-2
each; -41 informed) and 000000's chosen components / TES500 / the three batch parents.
