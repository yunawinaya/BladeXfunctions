# Item Disassembly V2 - live-check runbook (package E, DEV, Wed 2026-10-21)

Every step marked **WRITE** is run by the controller only, one batch at a time, after the user's yes (one yes per batch). Everything else
is read-only (SELECTs through `.dbtools/db --dev`) or local (node / python on files). The kit never calls the platform itself: `cmds.py`
only PRINTS the literal run command (`node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id<tenant>.json <workflowId> <request>
<out>`, the minted-token route of skill running-dev-workflows-as-tenant, POST https://dev.mes.sudu.ai/api/su-code-workflow/workflow/run/<id>,
the STORED version), which the controller runs as its own shell call (the runas allow rule matches nothing chained). Plan:
`.superpowers/sdd/there-s-this-item-dissasembly-binary-sonnet/plan.md` ("Verification" 1-10); contract: `scratchpad/idav2/CONTRACT.md`
(it wins over this file). Workflow ids: `scratchpad/idav2/ids.json` (IDA_V2_SUBMIT 2112748971830149121, WORKER 2112749010379997186, PREPARE
2112749086439505922, COMMIT 2112749139006717954; IDA_SAVE 2107305535347552257). Answers are HTTP 200 even when the workflow refused: read
`data` with `python3 $K/cmds.py ans <out.json>`.

**IDA has no revert.** Every completion below stays: its source stock is consumed and its components received for good (the table at the
end says what and where). Nothing here can be undone through IDA; leave it (test stock) or correct it by hand outside this kit.

## Tenants and the data the expectations rest on (read 2026-10-21)

- **711077** (Test Mosca, plant 2105200506810306561, admin@711077): no IDA numbering rule - the form's number field is canManualInput, so
  the type select offers only Manual Input (-9999, a NUMBER) and every 711077 IDA carries a typed number (`IDV2-<subject>-<MMDDHHMMSS>`,
  checked unused). Source 2783-000000-00 (2105489115887079441): ONE positive balance, 100,000 at A1-01 2106278340907413505, one FIFO layer
  100,000 @ 0 - so every 711077 receipt prices at 0 (the price checks there are trivially true; their teeth are the 000000 runs and
  test_alloc.js). **Receipts go to ONE bin: J3-07 2107138647224946690** (Warehouse storage 2105223032261218305): of the plant's 380 bins only
  A1-01 (-41's GD stock) and MBA (the LOT V2 session, 10-19 / 10-20) ever had a movement; J3-07, the last Warehouse bin, never had one.
  Never pick "blade, loose" 2105492637718319110 at A1-01 (not in either BOM; the builder drops / refuses it); never touch SO/20261016-034 / -035.
- **000000** (ASAI, org 1123598813738675201, plant 1123598813738675202, admin@000000): rule 'IDA Doc' 2107022471794724866 (IDA-2610-nnn;
  Drafts: DRAFT-IDA-2610-nnn); number rules Inventory Price 4 dp / Qty 3 dp since 2026-10-19 16:25 (the stored prices round: 0.16666667 ->
  0.1667). Source ITEM-0035 2107721324476432385 (FIFO, PCS): three positive balances -> Select Stock (the dialog pick of A1-B1
  2107724306903400449, 397); its FIFO layer 1 has 197 @ 10.00, so one unit issues at 10. Its BOM = Bom-1 (NONE), Bom-2 (AUTO), Bom-3
  (TYPED). Batch config 2062365526375706626 (Organization Level, Batch-%5d, Document Created Date) **running_number = the NEXT number**
  (631 issues Batch-00631). The quiet NONE items (no movement in 30 days, created before 10-19) are picked by the builder at build time.
- Other sessions on dev: -41 (GD, 711077 A1-01), the LOT V2 session (711077 MBA), the inbound / IA sessions (000000). Tell -41 and the
  engine owner (-c8) before and after the 711077 window; lock waits against another V2 document are only by arrangement (item 9).

## Shell

From the repo root (READ-ONLY commands only):
```sh
export IDA_LIVE_OUT=/Users/yunawinaya/Documents/ASC-dev/idav2-live    # durable, outside the repo (requests + dev snapshots); not /tmp
. scratchpad/idav2/live/env.sh                                        # K TW F S RP T711 T000
```

## Kit (`scratchpad/idav2/live/`, `scratchpad/idav2/test/twins/`; package E)

| File | What |
|---|---|
| `config.json` | tenants (org, plant, number rule, receipt bin), the subjects `a b c r1 d p8`, budgets (CONTRACT section 14) |
| `idalib.py` | read-only SELECTs, the client db API shapes, NOT_RECORD + the idempotency key (= D's client), node calls into `code/shared` |
| `build_ida_payload.py` | deliverable 1: IDA_SAVE requests in the v35 web shape + the IDA_V2_SUBMIT / STATUS requests + plan.json; `edit` (a stored IDA as the Edit / `--clone` form sends it), `check` |
| `variant.py` | negative / second-click variants: `over`, `qty N`, `gen`, `no-bin`, `typed X`, `big N`; `autonum P` = every AUTO line typed `P-<n>` (unused in the org) + plan.json rebuilt - the runas route of a classic Completed save with AUTO lines (item 1 note) |
| `ida_moves.js` / `plan_ida.js` | the CONTRACT section 5 builder; the REAL engine planner (scratchpad/gdc/engine/core.js) over a snapshot: op 1, idaAllocate, op 2 - the expected rows or PREPARE's refusal |
| `snap_ida.py` / `diff_twins_ida.py` | deliverable 3: what an IDA touches; twin delta diff (masks, deliberate differences, `--expect`, `--nothing-moved`) |
| `recon_ida.py` / `recon_lib.py` / `ida_expect.js` | deliverable 4: reconcile a V2-completed IDA by formula (`--classic [--v6]`: a classic one): every stored price / qty EXACT at the tenant's number rule (core.js arithmetic), the AUTO lines from the BATCH part + D1 intent (after D4 they hold their numbers), drift before vs after, WA / FIFO rows; run it with `--before <snapshot>` for the full proof |
| `cmds.py` / `tick_ida.sh` / `runs_ida.py` | the printed runas commands (a classic / draft save prints ONCE: its `.out.json` existing means it ran - a retry after a timeout saves a second IDA - so it refuses unless `--again`; a request only v7 refuses - > 250 moves Completed, an Edit of a stored non-Draft IDA - is refused while the live IDA_SAVE lacks the v7 guard); **WRITE** worker kicks until terminal; read-only run table (seconds, MB) |
| `test_kit.py` | offline + read-only tests of the kit (54 checks with every subject built; 10-12 = fix round 1's synthetic units) |
| `test/twins/` | deliverable 2: `fetch_runs_ida.py`, `fetch_db_rows_ida.py`, `fetch_rules_ida.py`, `replay_ida.js`, `test_alloc.js`, `run_replay.sh` |

Offline status (2026-10-21 12:40; fix round 1 ~15:00: `test_kit.py` 54/54): `test_kit.py` 36/36 (subjects r1 c p8 a b d built); `run_replay.sh`: 3 recorded classic completions (IDA-2610-001 / -002 / -003, 12
child calls) -> MOVES 3/3, CALLS 12/12, DOC 3/3 identical (0 DIFF); test_alloc.js 18/18 (idaAllocate == B's v7 code_cost_alloc line for
line, v6 off only on non-base lines); self-test: 4 of 8 engine mutations caught (the other 4 need a batch SUBTRACT, a WA item or a number
rule at the runs' time - none in the corpus), 10 / 10 builder mutations caught.

---------------------------------------------------------------------------------------------------------------------------
## Step 0 - pre-flight (read-only)
```sh
python3 scratchpad/idav2/base/snapshot.py --check                     # dev moved since WP0's bases? (expect ok, or only our batch publishes)
for w in IDA_SAVE IDA_V2_SUBMIT IDA_V2_WORKER IDA_V2_PREPARE IDA_V2_COMMIT; do .dbtools/wf --dev deployed "Item Disassembly/AsyncV2/$w.json"; done
python3 $K/build_ida_payload.py check --tenant 711077                 # no open COMPLETE_IDA job, no Processing IDA, J3-07 clean
python3 $K/build_ida_payload.py check --tenant 000000
python3 $K/test_kit.py                                                # 54/54 (with r1 c p8 a b d built)
bash $TW/run_replay.sh $RP                                            # 0 DIFF over the recorded classic completions
```
Expect IDENTICAL for every deployed file, exit 0 everywhere. `--any` builds a request meant to be refused (its failing checks print
EXPECTED). Build every subject RIGHT BEFORE its test (the picks are today's balances,
the typed numbers and the 711077 number are stamped at build time): `python3 $K/build_ida_payload.py <subject>` (exit 1 = a check failed:
read the FAIL lines; never run a request whose build failed). Snapshots: `$S/<tag>.<n>.json`.

---------------------------------------------------------------------------------------------------------------------------
## 1 - Classic IDA_SAVE v7 (switch OFF), tenant 000000, subject r1 (ITEM-0035 x 1 -> Bom-1 / Bom-2 / Bom-3 + one BAG line)

**Route limit (live finding 10-21, run 2112793941729775618, nothing written):** through runas a classic Completed save cannot number an
AUTO line: GENERATE_BATCH (v20) takes org = organization_id ?? `{{global:firstLvDeptId}}`, the classic passes none, a minted token carries
no session global -> "No default batch found.". So **every classic Completed step with an AUTO line (item auto-rule + placeholder / '')
runs its `variant.py <tag> autonum <prefix>` folder** (those lines typed `<prefix>-<n>`, unused in the org; plan.json rebuilt: TYPED rows,
AUTO 0, no config advance, the prices unchanged). Unaffected: the refusals answered before the batch loop (v7 guard 400 / 409, 401, 402),
Draft saves (no batch loop), tags without AUTO lines (a b d), every V2 step (no `{{global:}}` in IDA_V2_* or INVENTORY_BULK_APPLY;
ADD_INVENTORY v65 / SUBTRACT_INVENTORY v59 have none either - SELECT). The form route (browser) numbers AUTO lines normally (IDA-2610-003).
```sh
python3 $K/build_ida_payload.py r1
python3 $K/variant.py r1 no-bin ; python3 $K/variant.py r1 over ; python3 $K/variant.py r1 big 250
python3 $K/variant.py r1 autonum IDV2AN-R1-<MMDDhhmm>     # Bom-2 + the BAG line (AUTO) -> typed <prefix>-1 / -2; plan.json: AUTO 2 -> 0, TYPED 1 -> 3
python3 $K/snap_ida.py --tenant 000000 --request $F/r1-autonum/classic.json --out $S/r1.0.json
node $K/plan_ida.js $F/r1-autonum/classic.json $S/r1.0.json   # PLAN OK: 1 OUT @ 10, 4 IN; the BAG line at 0.07692308 per PCS (10 / 13 shares / 10 base)
python3 $K/cmds.py classic r1-no-bin   # run it: "401" "Line 1 (Bom-1): bin location is required."                    (nothing written)
python3 $K/cmds.py classic r1-over     # "402" "Insufficient stock for item ITEM-0035 (Unrestricted). Available: 397, Requested: 398" (nothing)
python3 $K/cmds.py classic r1-big      # "400" "This Item Disassembly has 255 source picks and recovery lines - too big for the classic save, ..." (v7 guard)
                                       # **WRITE on v6 - run only after batch 1** (v7's refusal; cmds.py refuses to print it while the enabled IDA_SAVE lacks code_node_IDAguardStored)
python3 $K/cmds.py classic r1-autonum  # WRITE (Add -> Completed): "200" "Item Disassembly saved." id <r1 id>   (plain `classic r1`: "No default batch found.")
python3 $K/snap_ida.py --tenant 000000 --ida <r1 id> --base $S/r1.0.json --out $S/r1.1.json
python3 $K/recon_ida.py <r1 id> --tenant 000000 --classic --before $S/r1.0.json      # RECONCILED with the v7 rule (per BASE unit)
python3 $K/recon_ida.py <r1 id> --tenant 000000 --classic --v6                        # FAILS on R4 only: v6 would price the BAG line x10
python3 $K/build_ida_payload.py r1 --tag r1d ; python3 $K/cmds.py draft r1d          # WRITE (Add -> Draft): "200" id <draft id>; no movement
python3 $K/build_ida_payload.py edit --tenant 000000 --ida <draft id> --tag r1d-edit
python3 $K/variant.py r1d-edit autonum IDV2AN-R1D-<MMDDhhmm>   # the stored Draft's 2 AUTO lines typed (the Edit keeps its id)
python3 $K/cmds.py classic r1d-edit-autonum   # WRITE (Draft -> Completed, Edit): "200"; then recon --classic on <draft id>
python3 $K/build_ida_payload.py edit --tenant 000000 --ida <r1 id> --tag r1-done --any
python3 $K/cmds.py draft r1-done       # stale-tab Draft on a Completed IDA: v7 "409" "This Item Disassembly is already Completed and cannot be saved again."
python3 $K/cmds.py classic r1-done     # Completed again: "409" (code_idem_guard, same text)
                                       # both: **WRITE on v6 - run only after batch 1** (v7's refusal; cmds.py refuses to print it while the enabled IDA_SAVE lacks code_node_IDAguardStored)
python3 $K/snap_ida.py --tenant 000000 --ida <r1 id> --base $S/r1.1.json --out $S/r1.2.json   # the two 409s wrote nothing (diff r1.1 / r1.2 by eye: ida, mv unchanged)
bash $TW/run_replay.sh $RP             # the new classic runs: MOVES / CALLS / DOC identical (v7's prices = idaAllocate)
```
v7 vs v6 on base-UOM lines: identical prices (test_alloc.js + the replay); the BAG line now 0.07692308 per PCS (v6: 0.76923077, i.e. x10).
Leaves: 2 IDAs Completed (r1, r1d) + the 4 x 2 lines; per completion -1 ITEM-0035 at A1-B1 (layer 1 @ 10), +5 Bom-1, +5 Bom-2 (new batch
<prefix>-1), +2 Bom-3 (new typed batch), +10 PCS METHYLENEDIOXYMETHAMPHETAMINE (new batch <prefix>-2) at A1-B1, no AUTO number (autonum),
the classic's blank Batch row for Bom-1, item stamps. The refusals write nothing.

## 2 - Guards (v7): Processing -> 400 (both buttons); stale-tab Draft -> 409 (done in 1); > 250 moves -> 400 (done in 1)
Inside item 6, after `cmds.py submit c` answered QUEUED and BEFORE its first tick (the IDA is Processing):
```sh
python3 $K/build_ida_payload.py edit --tenant 000000 --ida <c ida_id> --tag c-busy --any        # WARN: stored Processing
python3 $K/snap_ida.py --tenant 000000 --ida <c ida_id> --out $S/busy.0.json
python3 $K/cmds.py draft c-busy        # "400" "This Item Disassembly is being processed in the background - please wait for it to finish."
python3 $K/cmds.py classic c-busy      # the same 400
                                       # both: **WRITE on v6 - run only after batch 1** (v7's refusal; cmds.py refuses to print it while the enabled IDA_SAVE lacks code_node_IDAguardStored)
python3 $K/cmds.py submit c-busy       # V2: BUSY 409 IDA_BUSY (stored Processing / the open job), nothing written
python3 $K/snap_ida.py --tenant 000000 --ida <c ida_id> --base $S/busy.0.json --out $S/busy.1.json   # ida / idal / mv unchanged
```

## 3 - Twins in 711077 (subject b: 58-component BOM 2105497919928307730, base UOM, FIFO; A = classic, B = V2, sequential)
```sh
python3 $K/build_ida_payload.py b                                         # availability for TWO runs; numbers IDV2-B-<stamp>-A / -B
python3 $K/snap_ida.py --tenant 711077 --request $F/b/classic.json --out $S/b.A0.json
node $K/plan_ida.js $F/b/classic.json $S/b.A0.json                        # PLAN OK: 1 OUT + 58 IN at 0
python3 $K/cmds.py classic b                                              # WRITE (twin A): "200" id <A id>
python3 $K/snap_ida.py --tenant 711077 --ida <A id> --base $S/b.A0.json --out $S/b.A1.json
python3 $K/snap_ida.py --tenant 711077 --request $F/b/submit.json --out $S/b.B0.json
python3 $K/cmds.py submit b                                               # WRITE (twin B): QUEUED, job_id, ida_id
python3 $K/cmds.py tick b --job <job>                                     # WRITES: 1 tick -> COMPLETED (59 movements: SPLIT, one tick)
python3 $K/cmds.py status b                                               # STATUS (no write): COMPLETED, terminal YES
python3 $K/snap_ida.py --tenant 711077 --ida <B id> --base $S/b.B0.json --job <job> --out $S/b.B1.json
python3 $K/diff_twins_ida.py $S/b.A0.json $S/b.A1.json $S/b.B0.json $S/b.B1.json --expect $F/b/plan.json --json $S/b.diff.json
python3 $K/recon_ida.py <B id> --tenant 711077 --before $S/b.B0.json      # V2 by formula: RECONCILED
python3 $K/recon_ida.py <A id> --tenant 711077 --classic --before $S/b.A0.json
bash $TW/run_replay.sh $RP                                                # twin A's recorded calls replayed as op 1 + op 2: identical
```
Expect `tables differing: 0; failed checks: 0`; `--mask-prices` only when plan.json's `fifo_layers_used` holds two or more prices (the
twins' issues take different layers; the diff refuses it otherwise); DELIBERATE: A's 58 blank Batch rows (one per NONE line); FOREIGN lines name other
sessions' movements in a window (then a balance DIFFER is theirs - re-check with `recon_ida.py --before`). A creates the J3-07 balance
rows, B updates them: the diff compares quantity deltas, so that is SAME. Per twin: 1 IDA + 58 lines, 1 OUT + 58 IN, -1 parent at A1-01, +58
components at J3-07, 58 new FIFO layers @ 0, 59 item stamps; B adds the job, IDC|<B> LOCK|1, P| parts, D0 D2 D3 D4, two engine operations,
keyed movements. Leaves: -2 x 2105490483502813224 at A1-01, +2 x the 58 components at J3-07, A's 58 blank Batch rows.

## 4 - 830 lines (subject a: 2783-000000-00 x 1 -> its 830-component BOM, every receipt into J3-07)
```sh
python3 $K/build_ida_payload.py a
python3 $K/snap_ida.py --tenant 711077 --request $F/a/submit.json --out $S/a.0.json
node $K/plan_ida.js $F/a/submit.json $S/a.0.json                          # PLAN OK, OUT total 0, 830 IN
python3 $K/cmds.py classic a              # the classic refuses it: "400" "... has 831 source picks and recovery lines - too big for the classic save ..."
                                          # **WRITE on v6 - run only after batch 1** (v7's refusal; cmds.py refuses to print it while the enabled IDA_SAVE lacks code_node_IDAguardStored)
python3 $K/cmds.py submit a               # WRITE: QUEUED (request ~0.8 MB)
python3 $K/cmds.py tick a --job <job>     # WRITES: PREPARE -> COMMIT A (op 1: 1 movement) -> SPLIT -> B (op 2: 830, items, Completed); 1-2 ticks
python3 $K/cmds.py status a
python3 $K/recon_ida.py <ida_id> --tenant 711077 --before $S/a.0.json --json $S/a.recon.json
python3 $K/runs_ida.py IDA_V2_SUBMIT --tenant 711077 --like <idempotency key from $F/a/plan.json> -n 3
```
Expect RECONCILED: 1 OUT IDC|<job>|I|M1 = the pick, 830 IN IDC|<job>|R|R1..R830 = the lines at 0 (zero-cost layer), no Batch row, 830 new
FIFO layers, every touched key = its movement history, 0 locks held, 831 items stamped; runs SUBMIT <= 25 MB, PREPARE <= 30, COMMIT <= 30,
one tick <= ~35 MB; timings = job queued_at -> finished_at + the run seconds recon prints. The form route (switch ON): Item Disassembly ->
Add, plant HQ, 2783-000000-00, qty 1 (the explode, the single-source pick), change every line's bin to J3-07 (or keep the build), Completed
-> V2 (831 > 50). Leaves: -1 2783-000000-00 at A1-01; +the 830 components x their BOM qty at J3-07.

## 5 - 2,000 lines (subject d: 2783-000000-00 x 1 -> 2,000 Batch Add lines of distinct stock items, qty 1, J3-07; NEVER post it)
```sh
python3 $K/build_ida_payload.py d
python3 $K/snap_ida.py --tenant 711077 --request $F/d/submit.json --out $S/d.0.json
node $K/plan_ida.js $F/d/submit.json $S/d.0.json
python3 $K/cmds.py submit d                     # WRITE: QUEUED (request ~2 MB)
python3 $K/cmds.py tick d --job <job>           # WRITES: >= 2 ticks (PREPARE + COMMIT A -> PARK: op 2 has 2,000 > 1,000; then B)
python3 $K/recon_ida.py <ida_id> --tenant 711077 --before $S/d.0.json --json $S/d.recon.json
```
Expect RECONCILED with 2,000 IN rows; the run table shows PARK after COMMIT A and every run within budget (the point of the test).
Leaves: -1 2783-000000-00 at A1-01; +1 each of 2,000 items at J3-07 (2,000 new FIFO layers @ 0).

## 6 - Batches in 000000 (subject c: 51 lines, 52 moves; V2 called directly - SUBMIT does not enforce the client's > 50)
```sh
python3 $K/build_ida_payload.py c                # plan.json: the 8 Batch rows (Bom-3 TYPED, JN-MANUAL-02 x 2 = ONE TYPED row of 2, 6 AUTO with
                                                 # the numbers batchnum predicts from today's config), the alt-UOM line, the prices
python3 $K/snap_ida.py --tenant 000000 --request $F/c/submit.json --out $S/c.0.json      # KEEP: the BNC row before
node $K/plan_ida.js $F/c/submit.json $S/c.0.json
python3 $K/cmds.py submit c                      # WRITE: QUEUED   (item 2's guard checks HERE, before the tick)
python3 $K/cmds.py tick c --job <job>            # WRITES: D1 numbers + Batch rows, op 1, op 2, D4 numbers into the lines
python3 $K/recon_ida.py <ida_id> --tenant 000000 --before $S/c.0.json
python3 $K/runs_ida.py GENERATE_BATCH --tenant 000000 -n 3     # V2 numbers in memory: no run of ours; another session's run shifts the numbers
.dbtools/db --dev "SELECT CAST(id AS CHAR) id, batch_number, CAST(material_id AS CHAR) m, CAST(initial_quantity AS CHAR) iq, transaction_no FROM batch WHERE tenant_id = '000000' AND is_deleted = 0 AND transaction_no = '<ida number>' ORDER BY id"
```
Expect RECONCILED: 8 live Batch rows (no blank one), the AUTO numbers = plan.json's (when nobody else generated since the build; else the
next ones in order), the config advanced by 6, JN-MANUAL-02's typed number one row of initial_quantity 2 received into A1-B1 and A1-B2, the
BAG line 10 PCS at value / 10, FIFO / WA / no-method items as plan_ida.js shows (Fixed Cost JN-MANUAL-02 at purchase_unit_price), the
prices at 4 dp. Leaves: -1 ITEM-0035 at A1-B1; +the 51 lines (A1-B1 / A1-B2), 8 Batch rows, 6 AUTO numbers, first WA rows of the 5 WA items.

## 7 - Failures
7a short stock -> FAILED, nothing moved, Draft; the second click works (000000, r1):
```sh
python3 $K/build_ida_payload.py r1 --tag f7 ; python3 $K/variant.py f7 over          # the pick = available + 1 (BOM rows rescaled)
python3 $K/snap_ida.py --tenant 000000 --request $F/f7-over/submit.json --out $S/f7.0.json
node $K/plan_ida.js $F/f7-over/submit.json $S/f7.0.json      # PLAN REFUSED op 1 INSUFFICIENT at M1
python3 $K/cmds.py submit f7-over                            # WRITE: QUEUED (SUBMIT does not check stock)
python3 $K/cmds.py tick f7-over --job <job>                  # WRITES: 1 tick -> FAILED IDA_INVENTORY_INSUFFICIENT
python3 $K/cmds.py status f7-over                            # FAILED, "Insufficient quantity - source pick 1 (ITEM-0035), bin A1-B1 (Unrestricted)"
python3 $K/snap_ida.py --tenant 000000 --ida <ida_id> --base $S/f7.0.json --job <job> --out $S/f7.1.json
python3 $K/diff_twins_ida.py --nothing-moved $S/f7.0.json $S/f7.1.json --code IDA_INVENTORY_INSUFFICIENT     # NOTHING MOVED (no number consumed)
python3 $K/build_ida_payload.py edit --tenant 000000 --ida <ida_id> --tag f7-edit         # the stored Draft (still 398)
python3 $K/variant.py f7-edit qty 1 --gen 2                  # the corrected pick, the next key generation
python3 $K/cmds.py submit f7-edit-qty                        # WRITE: QUEUED (Edit of the Draft)
python3 $K/cmds.py tick f7-edit-qty --job <job2>             # WRITES -> COMPLETED
python3 $K/recon_ida.py <ida_id> --tenant 000000 --job <job2>
```
7b a typed number taken after SUBMIT -> IDA_BATCH_DUPLICATE (000000): SUBMIT c (fresh numbers) WITHOUT a tick, take its Bom-3 number with a
classic save, then tick:
```sh
python3 $K/build_ida_payload.py c --tag t7 ; python3 $K/snap_ida.py --tenant 000000 --request $F/t7/submit.json --out $S/t7.0.json
python3 $K/cmds.py submit t7                                 # WRITE: QUEUED (no tick yet)
python3 $K/build_ida_payload.py r1 --tag t7-taker --typed <t7's Bom-3 number: plan.json batch_rows TYPED Bom-3>
python3 $K/variant.py t7-taker autonum IDV2AN-T7-<MMDDhhmm>  # route limit (item 1): the taker's 2 AUTO lines typed, Bom-3 keeps t7's number
python3 $K/cmds.py classic t7-taker-autonum                  # WRITE: the classic mints a Batch row holding that number
python3 $K/cmds.py tick t7 --job <job>                       # WRITES: FAILED IDA_BATCH_DUPLICATE "Line 3 (Bom-3): Batch No <n> already exists. Nothing was moved."
python3 $K/snap_ida.py --tenant 000000 --ida <t7 ida_id> --base $S/t7.0.json --job <job> --out $S/t7.1.json
python3 $K/diff_twins_ida.py --nothing-moved $S/t7.0.json $S/t7.1.json --code IDA_BATCH_DUPLICATE   # (t7-taker's own rows are FOREIGN)
python3 $K/build_ida_payload.py edit --tenant 000000 --ida <t7 ida_id> --tag t7-edit ; python3 $K/variant.py t7-edit typed IDV2T7-<new> --gen 2
python3 $K/cmds.py submit t7-edit-typed ; python3 $K/cmds.py tick t7-edit-typed --job <job2>     # WRITES -> COMPLETED
```
PREPARE refuses before D1, so no Batch row and no AUTO number of t7 are written. The "our Batch rows soft-deleted" path (a refusal after D1,
e.g. op 1 refused at D2) cannot be staged live (the stock would have to vanish between PREPARE and D2 inside one tick): C's / E phase 2's
interpreter sims cover it. Leaves: f7's IDA completed with 1 unit (as r1); t7-taker = an r1 completion; t7 completed with its new number.

## 8 - Complete & Post in 000000 (browser; posts into the dev accounting DB - the user's yes first; flag F1)
F1: the posting fetch refuses a recovery `batch_number` of `-` (every NONE line), so the posted IDA must have only batch lines: subject p8
(Bom-2 AUTO, Bom-3 TYPED, 49 AUTO Batch Add lines; Bom-1 dropped). Switch ON on dev (D's client with `--on`, COMPLETE_POST ON).
```sh
python3 $K/build_ida_payload.py p8
python3 $K/cmds.py draft p8                      # WRITE: a stored Draft with the 51 lines (no movement), id <p8 id>
#   the user, in the browser as a 000000 user: Item Disassembly -> open <p8 id> (Edit) -> Completed & Post (52 moves > 50 -> V2)
.dbtools/db --dev "SELECT CAST(id AS CHAR) id, job_status, DATE_FORMAT(finished_at, '%Y-%m-%d %H:%i:%s') fin FROM gd_async_job WHERE tenant_id = '000000' AND command = 'COMPLETE_IDA' AND correlation_id = 'IDA|<p8 id>' ORDER BY id DESC"
python3 $K/runs_ida.py ACC_PRODUCER --tenant 000000 --like <p8 id> -n 3     # the post's run: its id time AFTER the job's finished_at
.dbtools/db --dev "SELECT stock_movement_no, item_disassembly_status, posted_status FROM sm_item_disassembly WHERE tenant_id = '000000' AND id = <p8 id>"
python3 $K/recon_ida.py <p8 id> --tenant 000000 --posted
```
Expect: the post starts only after COMPLETED (ACC_PRODUCER after finished_at; DB clock = MYT), posted_status Pending Post -> Fully Posted.
If the 420 s wait ends first: "Still completing in the background; post it from the list once it shows Completed." and no ACC_PRODUCER
run until the user posts from the list. Never Complete & Post d (> 1,000 items) or any IDA with a `-` line. Leaves: as c (50 AUTO numbers)
+ the accounting entries.

## 9 - BUSY, double click, lock waits (000000)
```sh
python3 $K/build_ida_payload.py r1 --tag k1
python3 $K/cmds.py submit k1 ; python3 $K/cmds.py submit k1     # WRITE once: the 2nd answers route STATUS with the SAME job_id
.dbtools/db --dev "SELECT COUNT(*) n FROM gd_async_job WHERE tenant_id = '000000' AND idempotency_key = '<key of k1>'"      # 1
python3 $K/build_ida_payload.py edit --tenant 000000 --ida <k1 ida_id> --tag k1-busy --any && python3 $K/cmds.py submit k1-busy
#   BUSY 409 IDA_BUSY (another key, the IDA Processing / its job open) - nothing written
python3 $K/cmds.py tick k1 --job <job>
```
Lock waits: two V2 jobs on shared materials - `build_ida_payload.py c --tag k2` and `p8 --tag k3` (both issue ITEM-0035 at A1-B1 and receive
the same AUTO items), `cmds.py submit k2` / `submit k3`, then start BOTH tick loops at the same moment in two background shells. Expect both
COMPLETED; the later one's job shows progress_message IDA_LOCK_WAIT for a while (the engine's 409 -> lockWait 15 s x 2^n). If they did not
overlap, repeat with subject d (op 2 holds 2,000 x ITEM / COST keys longest) and a 711077 r1-like IDA on one of d's items. Against another
session's engine documents (GD V2 -41, LOT V2, IA V2): only by arrangement with them; same read-back (recon on ours, their job rows).
Leaves: k1 = an r1 completion; k2 = c, k3 = p8 completions.

## 10 - The client at 2,000 lines (the user's browser, after the ON publish)
1. 711077: Item Disassembly -> Add, plant HQ, source 2783-000000-00, qty 1 -> time the 830-line explode (until every row shows its UOM
   options) and the single-source auto-pick.
2. `python3 $K/build_ida_payload.py d --tag d10 ; python3 $K/cmds.py draft d10` (WRITE: the classic Draft save of 2,000 lines - time it with
   `python3 $K/runs_ida.py IDA_SAVE --tenant 711077 -n 1`), then open the Draft (Edit) -> time the form load; Completed -> V2: time to
   "completing in the background", the follow loop, the verdict; `python3 $K/recon_ida.py <id> --tenant 711077`.
Record the timings; fix only what blocks (plan). Leaves: d10 = a d completion (another 2,000 x 1 at J3-07, -1 2783-000000-00).

---------------------------------------------------------------------------------------------------------------------------
## If something goes wrong
- A classic answer other than the one expected: stop; `python3 $K/runs_ida.py IDA_SAVE --tenant <T> -n 1` and `.dbtools/wf --dev trace <id>`.
  The classic is not atomic: after a mid-loop failure the IDA is already Completed with part of its stock moved (snapshot first).
- A V2 job FAILED where it should not: nothing moved (phase A) and the IDA is back to Draft; read `error_code` / `error_message`, the worker
  answers in `$F/<tag>/worker.<job>.tick*.out.json`, then trace the PREPARE / COMMIT runs (`runs_ida.py IDA_V2_COMMIT --tenant <T> --like <job>`).
- REQUIRES_REVIEW: do NOT re-kick. The CONTRACT section 9 runbook (op 1 vs op 2 under review, the IBA|REVIEW rows of IDC|<job>|I / |R) is
  the controller's call; the IDA stays Processing and the engine keeps its locks (they block GD / GR / SA / Putaway / IA V2 on those items).
- A snapshot shows a lock held (`snap_ida.py` prints it): find its owner (`owner_operation_id`) before going on.
- `diff_twins_ida.py` DIFFER: the printed key + columns are the finding; FOREIGN lines name other sessions' movements in the window.
- `recon_ida.py` fingerprint FAIL after D4: AUTO lines carry their generated numbers now; recon re-reads them with the placeholder and with
  '' - a FAIL means the stored lines changed some other way.

## Write count and what stays (IDA has no revert)
| Item | Writes | Stock consumed | Stock received (bin) | Other rows left |
|---|---|---|---|---|
| 1 | 3 IDA_SAVE writes (+4 refusals, 0 writes) | 2 x 1 ITEM-0035 (A1-B1, @ 10) | 2 x (Bom-1 5, Bom-2 5, Bom-3 2, METHYLENEDIOX 10 PCS) at A1-B1 | 3 IDAs (1 Draft completed), 4 AUTO numbers, Batch rows, 2 blank Batch rows |
| 2 | 0 (3 refusals) | - | - | - |
| 3 | 1 IDA_SAVE + 1 SUBMIT + ticks | 2 x 1 2105490483502813224 (A1-01, @ 0) | 2 x the 58 components (J3-07) | 2 IDAs, 1 job, 58 blank Batch rows (A) |
| 4 | 1 SUBMIT + 1-2 ticks | 1 2783-000000-00 (A1-01) | the 830 components x BOM qty (J3-07) | 1 IDA, 1 job, 830 FIFO layers |
| 5 | 1 SUBMIT + >= 2 ticks | 1 2783-000000-00 | 2,000 items x 1 (J3-07) | 1 IDA, 1 job, 2,000 layers |
| 6 | 1 SUBMIT + 1 tick | 1 ITEM-0035 | the 51 lines (A1-B1 / A1-B2) | 8 Batch rows, 6 AUTO numbers, 5 first WA rows |
| 7 | 2 SUBMIT + ticks (7a), 2 SUBMIT + 1 classic + ticks (7b) | 3 x 1 ITEM-0035 | as r1 / c | 2 FAILED jobs (nothing moved), their IDAs completed by the second click |
| 8 | 1 classic Draft + the browser click + the post | 1 ITEM-0035 | 51 batch lines | 51 Batch rows, 50 AUTO numbers, accounting entries |
| 9 | 3-4 SUBMIT + ticks | as r1 / c / p8 | as r1 / c / p8 | 1 BUSY refusal |
| 10 | 1 classic Draft + the browser click | 1 2783-000000-00 | 2,000 x 1 (J3-07) | 1 IDA |
STATUS calls and refusals write nothing. Every 711077 receipt lands in J3-07 (no other session's bin); every 711077 issue takes the two
sources from A1-01 (qty 1-2 each; -41's GD stock is the same bin but other items).
