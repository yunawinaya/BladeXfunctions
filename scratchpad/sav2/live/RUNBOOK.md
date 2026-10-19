# SA V2 / SC Review V2 - live test runbook (package F, DEV tenant 496474)

Everything below that says **WRITE** runs only by the controller, one step at a time, after the user's yes (one yes per
batch is fine), with tenant 496474 announced to the other sessions first. Everything else is read-only (SELECTs through
`.dbtools/db --dev`) or local (node / python on files). The kit never calls the platform itself.

Live on dev (controller, 2026-10-16): SA_V2_SUBMIT 2111074320177860610 v3, SA_V2_WORKER 2111074368689180673 v3, SA_V2_PREPARE
2111074403720007681 v3, SA_V2_COMMIT 2111074444748689410 v4, STOCK_ADJUSTMENT 2032025505853816833 v25 (guarded), STOCK_COUNT
2066808904123076610 v11 (guarded), INVENTORY_BULK_APPLY 2109916822821744641 (engine v8, COST locks) + INVENTORY_LOCK_TOKENS v5.
Client switches stay OFF: every V2 call here is made directly, as admin@496474 (`runas.mjs`), with the request the client would send.

Test data: four NEW items (never the SACRACE-* race items - their cost rows are inconsistent on purpose), plant
1942795438353035266, bins b1 = Test-Batch-S2 2098295393555369986, b2 = Sealing Head Assembly 2105148434974937089 (Common, never
used: 0 balance / movement rows on 2026-10-16 21:00, while L1 / L2 / LB001-R1 / LG-001 carried other sessions' GD and race
traffic in the last 6 h).

| Item | Costing | Seed (100 / bin) | Purpose |
|---|---|---|---|
| SAV2T-FIFO | FIFO, no batch | b1 @1, b2 @2 -> layers 1, 2 | FIFO In priced, FIFO Out, In + Out on one key |
| SAV2T-WA | WA, no batch | b1 @10, b2 @20 -> ONE row 200 @ 15 | WA Out at the average, two priced Ins on one key |
| SAV2T-FIFOB | FIFO, batch SAV2T-B1 | b1 @3 (classic ADD creates the batch), b2 @4 | batch In + Out |
| SAV2T-ALT | FIFO, BOX = 10 PCS | b1 @5, b2 @6 (PCS) | alternate-UOM line (1 BOX out, 2 BOX in) |

**Twins are sequential on the same items** (A before / after, then B before / after); `diff_twins.py` compares DELTAS. The
documents are designed so B starts from A's prices: T1's WA Ins at 12 and 18 (+10 each) bring the average back to exactly 15;
FIFO Outs consume layer 1 in both twins; T3's review prices its Ins at the newest layer / WA price, which A's In leaves unchanged.

## Shell

From the repo root, in every shell call: `. scratchpad/sav2/live/env.sh` (sets `K` = kit dir, `F` = fixtures dir in the
session scratchpad, `S` = snapshots, `RUNAS` = `node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id496474.json`,
`WF_ITEM_SAVE WF_ADD WF_APPLY WF_SA WF_SC WF_SUBMIT WF_WORKER`). Every builder also prints its fully expanded runas commands.
Read an answer: `python3 $K/build_twins.py ans <file.out.json>`. List the test documents + their jobs: `python3 $K/build_twins.py docs`.

## Kit (scratchpad/sav2/live/, package F; E's build_review_2k.py / build_sa_2k.py / stock_reads.py / plan_check.js untouched)

| File | What |
|---|---|
| config.json | tenant / org / plant / bins / UOMs / rules / items (ids filled by `seed.py --fill-ids`) / workflow ids |
| twinlib.py | shared: read-only SELECTs, the client db API record shape, the clients' idempotency keys (canon + hash16, JS-exact) |
| make_items.py | step 0a requests (copy of race/make_item_requests.py + the BOX row) |
| seed.py | `--fill-ids`, `--plan` (0c / 0d requests), `--check [--seeded]` |
| build_twins.py | T1 / T2 / T3 / F1 requests + manifest.json (designed moves); `docs`, `ans`, `worker`, `status`, `dry-state`; `--dry` |
| snap.py | snapshot of every row a twin can touch (stock, cost rows, movements, items, SAs, SCs, jobs, steps, locks) |
| diff_twins.py | A's delta vs B's, table by table; `--expect` the designed moves; V2-only checks (job, steps, keys, locks) |
| plan_twin.js | the REAL engine planner over a snapshot: the rows a request will write (both twins), or the refusal |
| preflight_submit.js | the BUILT SA_V2_SUBMIT on B's interpreter over a snapshot: QUEUED or the refusal, before any dev call |
| tick.sh | WRITE: SA_V2_WORKER kicks for one job until terminal (controller only) |
| k2_build.py | E's 2k builder on clean items only (excludes SACRACE*/SAV2T*, cost-row migration, held locks, duplicate keys) |
| reconcile_2k.py | 2k: snapshot before, then job / SA / SC / movements / balances / FIFO / WA / node data checks |
| test_diff_twins.py, test_build_dry.py | offline tests (29 / 11 checks) |

Offline status (2026-10-16 21:50): `python3 $K/test_diff_twins.py` 29/29; `python3 $K/test_build_dry.py` 11/11 (T1-B, F1, T2-B,
T3-B all QUEUED on the interpreter; keys equal to the JS clients'); `node $K/plan_twin.js` on the dry T1 doc: PLAN OK, WA back to
215 @ 15; F1: PLAN REFUSED INSUFFICIENT at M2.

---------------------------------------------------------------------------------------------------------------------------
## Step 0 - pre-flight (read-only)

```sh
. scratchpad/sav2/live/env.sh
for w in SA_V2_SUBMIT SA_V2_WORKER SA_V2_PREPARE SA_V2_COMMIT STOCK_ADJUSTMENT; do .dbtools/wf --dev deployed "Stock Adjustment/AsyncV2/$w.json"; done
.dbtools/wf --dev deployed "Stock Count/AsyncV2/STOCK_COUNT.json"
python3 $K/k2_build.py check          # open V2 jobs of the tenant (expect none), plant traffic, excluded items
python3 $K/seed.py --check            # bins b1 / b2 active and unused; items not created yet (4 FAIL lines are expected here)
```
Expect IDENTICAL x6, no open COMPLETE_SA job. Announce tenant 496474 (twins on SAV2T-* in b1 / b2, then a 2k review on the plant).

## Step 0a - WRITE x4: the test items (ITEM_SAVE)
```sh
python3 $K/make_items.py              # read-only: the recorded 496474 Add as template -> $F/items/SAV2T-*.json, prints the 4 commands
$RUNAS $WF_ITEM_SAVE $F/items/SAV2T-FIFO.json  $F/items/SAV2T-FIFO.out.json
$RUNAS $WF_ITEM_SAVE $F/items/SAV2T-WA.json    $F/items/SAV2T-WA.out.json
$RUNAS $WF_ITEM_SAVE $F/items/SAV2T-FIFOB.json $F/items/SAV2T-FIFOB.out.json
$RUNAS $WF_ITEM_SAVE $F/items/SAV2T-ALT.json   $F/items/SAV2T-ALT.out.json
```
Writes per call: 1 `item` row + its `item_mji552rc_sub` UOM row(s) (ALT: 2, BOX = 10 PCS) + the Upsert-Items AI call every Item
save makes. Answer: `code 200, data.id`.
Check: `python3 $K/seed.py --fill-ids && python3 $K/seed.py --check` -> items ok (method / batch / base PCS / BOX row), no stock.

## Step 0c - WRITE x1: batch SAV2T-B1 (classic ADD_INVENTORY; the engine refuses new batches)
```sh
python3 $K/seed.py --plan             # writes $F/seed/seed1_add_batch.json + seed2_apply.json (S5 needs the batch id: re-run after 0c)
$RUNAS $WF_ADD $F/seed/seed1_add_batch.json $F/seed/seed1_add_batch.out.json
```
Writes: `batch` 1, `item_batch_balance` 1 (b1, 100), `item_balance` 1 (b1, 100), `fifo_costing_history` 1 (batch, seq 1, 100 @ 3),
`inventory_movement` 1 (IN, trx_no SAV2T-SEED). Answer: `data.code "200", batchId`.
Check: `python3 $K/seed.py --fill-ids` (fills items.fifob.batch_id) `&& python3 $K/seed.py --plan` (rebuilds seed2 with it; the
"batch_id is empty" warning must be gone).

## Step 0d - WRITE x1: the seed APPLY (INVENTORY_BULK_APPLY, operation SAV2T|SEED|1)
```sh
$RUNAS $WF_APPLY $F/seed/seed2_apply.json $F/seed/seed2_apply.out.json
```
Writes: `item_balance` 7 new (FIFO b1 b2, WA b1 b2, FIFOB b2, ALT b1 b2), `item_batch_balance` 1 new (FIFOB b2), `fifo_costing_history`
5 new (FIFO 1 @1 / 2 @2, FIFOB batch 2 @4, ALT 1 @5 / 2 @6), `wa_costing_method` 1 new (200 @ 15), `inventory_movement` 7 (keys
SAV2T|SEED|1|S1..S7), `inventory_balance_lock` ITEM| x7 + BATCH| x1 + COST| x4 (seeded, taken, released - the COST rows exist from
here on, so no later first-use seed race), `gd_publish_step` IBA|I|001 + IBA|DONE under SAV2T|SEED|1.
Answer: `code 200, result_code OK, "Applied 7 movements"`.
Check: `python3 $K/seed.py --check --seeded` -> ALL CHECKS PASSED (exact balances, layers, WA 200 @ 15, 8 seed movements, IBA|DONE, no lock held).

---------------------------------------------------------------------------------------------------------------------------
## Step 1 - Twin T1: SA form Add -> Completed (7 lines, 9 entries)

Lines: 1 FIFO In 10 @7 b1 | 2 FIFO Out 5 b1 (same key, after the In) | 3 WA Out 5 b1 | 4 WA In 10 @12 b2 | 5 WA In 10 @18 b2 (same
key again) | 6 FIFOB In 6 @8 b1 + Out 4 b2 (batch) | 7 ALT (BOX) Out 1 b1 + In 2 @60 b2. adjustment_type "Stock Count".
A = classic `STOCK_ADJUSTMENT {allData: getValues(), saveAs Completed, pageStatus Add}` (the recorded 496474 Add's keys);
B = `SA_V2_SUBMIT {operation SUBMIT, source FORM, saveAs Completed, pageStatus Add, sa_id "", idempotency_key SA:<org>:new-<token>:<hash16>:1, form = the record minus SA_NOT_RECORD, organization_id, nickname "", adjustment_date "", create_adjustment ""}`.

```sh
python3 $K/build_twins.py t1                                  # -> $F/t1/{A.classic,B.submit,B.status,manifest}.json
python3 $K/snap.py --out $S/T1.A0.json
node $K/plan_twin.js $F/t1/A.classic.json $S/T1.A0.json       # expect PLAN OK; WA ends 215 @ 15
$RUNAS $WF_SA $F/t1/A.classic.json $F/t1/A.classic.out.json   # WRITE (A)
python3 $K/build_twins.py ans $F/t1/A.classic.out.json        # code "200", id [<A sa id>]
python3 $K/snap.py --out $S/T1.A1.json
python3 $K/snap.py --out $S/T1.B0.json
node $K/preflight_submit.js $F/t1/B.submit.json $S/T1.B0.json # local: route QUEUED action DIRECT line_count 7
$RUNAS $WF_SUBMIT $F/t1/B.submit.json $F/t1/B.submit.out.json # WRITE (B): QUEUED, job_id, sa_id, sa_no
python3 $K/build_twins.py ans $F/t1/B.submit.out.json
sh $K/tick.sh <job_id> $F/t1                                  # WRITES: worker ticks until terminal (expect 1 tick -> COMPLETED)
$RUNAS $WF_SUBMIT $F/t1/B.status.json $F/t1/B.status.out.json # STATUS (no DB write): job_status COMPLETED, terminal YES
python3 $K/snap.py --out $S/T1.B1.json
python3 $K/diff_twins.py $S/T1.A0.json $S/T1.A1.json $S/T1.B0.json $S/T1.B1.json --expect $F/t1/manifest.json --json $S/T1.diff.json
```
Writes per twin: `stock_adjustment` 1 (Completed, an issued SA number, posted_status Unposted) + 7 lines; `item_balance` 7 updates
(FIFO b1 +5, WA b1 -5, WA b2 +20, FIFOB b1 +6, FIFOB b2 -4, ALT b1 -10, ALT b2 +20); `item_batch_balance` 2; `fifo_costing_history`
3 updates (FIFO / FIFOB batch / ALT layer 1: -5 / -4 / -10) + 3 new (10 @7, 6 @8 batch, 20 @60); `wa_costing_method` 1 (+15, price
stays 15); `inventory_movement` 9; `item.last_transaction_date` x4; REORDER_SET_REDIS (Redis). B adds: `gd_async_job` 1
(COMPLETE_SA), `gd_publish_step` SAC|<sa> LOCK|1, W0_CLAIM_n, P|..|ENGINE/LABELS/HDR/ITEMS/REORDER parts, A0_REVALIDATE,
A2_INVENTORY, A4_REORDER, A4_FINISH, SAC|<job> IBA|I|001 + IBA|DONE; lock rows taken / released (13 keys); `sa_v2_job_id`,
`sa_idem_key` on the SA; movements keyed SAC|<job>|M1..M9. A: none of those.
Check: diff_twins -> `tables differing: 0; failed checks: 0` (the engine's batch-row remark NULL -> '' shows as INFO).

## Step 2 - Twin T2: Draft -> Completed with a header edit and a line edit

Draft lines: 1 FIFO In 4 @9 b2 | 2 WA Out 3 b2 | 3 FIFOB Out 2 b1 (batch) | 4 ALT (BOX) Out 1 b2. Edits at completion (both twins):
adjustment_date -> the day before; line 2 Out 3 -> 4 (entry sa_quantity, total_quantity, adj_summary).
The Draft button saves by a direct db add (no workflow); the drafts here go through `STOCK_ADJUSTMENT {saveAs Draft, pageStatus Add}`
(add_node_jhZYWnLa: the same Draft header + filled-back lines; the form's db add would also store its dialog columns - both twins
start from the same kind of Draft, so the twin is unaffected).

```sh
python3 $K/build_twins.py t2-drafts                           # -> $F/t2/draftA.json, draftB.json (identical)
$RUNAS $WF_SA $F/t2/draftA.json $F/t2/draftA.out.json         # WRITE: SA Draft (Draft-SA-nnnn) + 4 lines; the answer has NO id
$RUNAS $WF_SA $F/t2/draftB.json $F/t2/draftB.out.json         # WRITE: the twin Draft
python3 $K/build_twins.py docs                                # the two newest "SA V2 live test T2 (twin)" Drafts: A = older, B = newer
python3 $K/build_twins.py t2 --sa-a <A id> --sa-b <B id>      # reads both Drafts (must be identical) -> $F/t2/{A.classic,B.submit,B.status,manifest}.json
python3 $K/snap.py --out $S/T2.A0.json
$RUNAS $WF_SA $F/t2/A.classic.json $F/t2/A.classic.out.json   # WRITE (A): classic Completed, Edit
python3 $K/snap.py --out $S/T2.A1.json
python3 $K/snap.py --out $S/T2.B0.json
node $K/preflight_submit.js $F/t2/B.submit.json $S/T2.B0.json # local: QUEUED action COMPLETE edited 1, parts DOC
$RUNAS $WF_SUBMIT $F/t2/B.submit.json $F/t2/B.submit.out.json # WRITE (B): COMPLETE of Draft B
sh $K/tick.sh <job_id> $F/t2
$RUNAS $WF_SUBMIT $F/t2/B.status.json $F/t2/B.status.out.json
python3 $K/snap.py --out $S/T2.B1.json
python3 $K/diff_twins.py $S/T2.A0.json $S/T2.A1.json $S/T2.B0.json $S/T2.B1.json --expect $F/t2/manifest.json --json $S/T2.diff.json
```
Writes: drafts 2 x (`stock_adjustment` 1 + 4 lines). Per twin at completion: the SA updated (Completed, an issued number replacing
the Draft number, adjustment_date -1 day, line 2 = 4); `item_balance` 4 (FIFO b2 +4, WA b2 -4, FIFOB b1 -2, ALT b2 -10);
`item_batch_balance` 1; `fifo_costing_history` 2 updates + 1 new (4 @9); `wa_costing_method` 1 (-4); `inventory_movement` 4 (doc_date
= the EDITED date in both: PREPARE overlays the DOC header, as the classic reads its header back after the update); items x4.
B adds: job, SAC|<sa> LOCK|1, S|..|DOC part, A1_SA_LINES (+ A1_TRY marker) besides the T1 steps.
Check: diff_twins -> 0 / 0.

## Step 3 - Twin T3: Stock Count Review -> Stock Adjustment

Two identical Stock Counts (count_type Location), 8 lines on the test items: FIFO b1 +3, FIFO b2 -2, WA b1 -1, WA b2 +2, FIFOB b2 +1
(batch), FIFOB b1 -1 (batch), ALT b1 -3, ALT b2 0 (approved without variance: no SA entry, still Adjusted). Every line approved
(SCapproveAll.js), createAdjustment "Yes". The review builds 7 SA lines; Ins priced at the newest FIFO layer / WA price
(classic and V2 run the same build).

```sh
python3 $K/build_twins.py t3-issue                            # -> $F/t3/scA.issue.json, scB.issue.json, plan.json, manifest.json
$RUNAS $WF_SC $F/t3/scA.issue.json $F/t3/scA.issue.out.json   # WRITE: SC A Issued (8 Pending lines) -> data.id
$RUNAS $WF_SC $F/t3/scB.issue.json $F/t3/scB.issue.out.json   # WRITE: SC B
python3 $K/build_twins.py t3-count --sc-a <A id> --sc-b <B id>  # -> scA.count.json, scB.count.json
$RUNAS $WF_SC $F/t3/scA.count.json $F/t3/scA.count.out.json   # WRITE: counts -> Completed / To Be Reviewed
$RUNAS $WF_SC $F/t3/scB.count.json $F/t3/scB.count.out.json   # WRITE
python3 $K/build_twins.py t3-review --sc-a <A id> --sc-b <B id> # -> A.review.json (classic), B.submit.json + B.status.json (V2)
python3 $K/snap.py --out $S/T3.A0.json
$RUNAS $WF_SC $F/t3/A.review.json $F/t3/A.review.out.json     # WRITE (A, 1/2): classic Review -> a Draft SA + SC lines Adjusted
python3 $K/build_twins.py ans $F/t3/A.review.out.json         # data.stockAdjustmentId
python3 $K/build_twins.py t3-complete-a --sa <stockAdjustmentId>  # the Draft as SCsaveReviewWorkflow.js fetches it -> A.complete.json
$RUNAS $WF_SA $F/t3/A.complete.json $F/t3/A.complete.out.json # WRITE (A, 2/2): classic Completed, Edit (moves the stock)
python3 $K/snap.py --out $S/T3.A1.json
python3 $K/snap.py --out $S/T3.B0.json
node $K/preflight_submit.js $F/t3/B.submit.json $S/T3.B0.json # local: QUEUED action REVIEW line_count 7, parts SC (FIFO In prices
                                                              #   read 0 there: B's cost mock has WA rows only - the gate is what counts)
$RUNAS $WF_SUBMIT $F/t3/B.submit.json $F/t3/B.submit.out.json # WRITE (B): REVIEW -> a NEW SA, Processing
sh $K/tick.sh <job_id> $F/t3
$RUNAS $WF_SUBMIT $F/t3/B.status.json $F/t3/B.status.out.json
python3 $K/snap.py --out $S/T3.B1.json
python3 $K/diff_twins.py $S/T3.A0.json $S/T3.A1.json $S/T3.B0.json $S/T3.B1.json --expect $F/t3/manifest.json --json $S/T3.diff.json
```
Writes: issue 2 x (`stock_count` 1 + 8 lines); count 2 x (8 lines + header). Per twin: a NEW `stock_adjustment` (Completed, issued
number, stock_count_id = its SC, adjustment_type Stock Count) + 7 lines; the SC's 8 lines Adjusted, header Completed / Completed /
Fully Adjusted; `item_balance` 7 (FIFO b1 +3, FIFO b2 -2, WA b1 -1, WA b2 +2, FIFOB b2 +1, FIFOB b1 -1, ALT b1 -3);
`item_batch_balance` 2; `fifo_costing_history` 3 updates + 2 new; `wa_costing_method` 1 (+1, price 15); `inventory_movement` 7;
items x4. A also burns one Draft number (its SA is created Draft, numbered at completion). B adds: SCR|<sc> LOCK|1, job, S|..|SC
part, SAC|<sa> LOCK|1, P| parts incl. SALINES / SC, A1_SA_LINES, A3_STOCK_COUNT.
Check: diff_twins -> 0 / 0. Known deliberate difference (not in the end state): A marks the SC lines Adjusted BEFORE the stock
moves, B after (CONTRACT ruling 7).

## Step 4 - F1: failure injection (Out exceeds the stock; built from the CURRENT stock, so build it right before running)
```sh
python3 $K/build_twins.py f1                                  # line 1 WA In 1 @15 b1 (valid), line 2 FIFO Out <b1 unrestricted + 1> b1
python3 $K/snap.py --out $S/F1.0.json
node $K/plan_twin.js $F/f1/B.submit.json $S/F1.0.json         # expect PLAN REFUSED INSUFFICIENT at M2
$RUNAS $WF_SUBMIT $F/f1/B.submit.json $F/f1/B.submit.out.json # WRITE: QUEUED (SUBMIT does not check stock)
sh $K/tick.sh <job_id> $F/f1                                  # expect terminal FAILED after 1 tick
$RUNAS $WF_SUBMIT $F/f1/B.status.json $F/f1/B.status.out.json # job_status FAILED, error_code SA_INVENTORY_INSUFFICIENT
python3 $K/snap.py --out $S/F1.1.json
python3 $K/diff_twins.py --nothing-moved $S/F1.0.json $S/F1.1.json --code SA_INVENTORY_INSUFFICIENT
```
Writes: `stock_adjustment` 1 + 2 lines (Processing, then back to **Draft** - the unlock), `gd_async_job` 1 FAILED (`SA_INVENTORY_INSUFFICIENT`,
"Insufficient quantity - line 2 (SAV2T-FIFO), bin Test-Batch-S2 (Unrestricted)"), SAC LOCK|1, claim, P| parts, A0_REVALIDATE; lock
rows taken and given back; NO balance / cost / movement row (not even line 1's valid In).
Check: `NOTHING MOVED` (ib / ibb / fifo / wa / batch / mv / item 0 changes; one new job FAILED SA_INVENTORY_INSUFFICIENT; its SA
Draft; no lock held). The F1 Draft stays on dev (2 lines on test items; harmless).

---------------------------------------------------------------------------------------------------------------------------
## Step 5 - 2k: SC Review V2 with 2,000 approved variance lines (E's builder, clean items)

Plant 1942795438353035266 (E's choice; checked clean 2026-10-16 21:30: 704 FIFO / WA items, no cost-row migration, no duplicate
balance key, no ITEM / BATCH / COST lock held, no open V2 job; excluded: SACRACE* + SAV2T*). Today's plan: 2,000 lines - Out 527,
In 1,473 (753 "found stock" Ins on bins without a row), 40 batch, FIFO 1,963 / WA 37; the review builds ~1,162 SA lines (<= 50 entries);
engine planner on today's rows: PLAN OK, item_balance 1,215 upd + 753 new, item_batch_balance 40, FIFO 512 upd + 1,448 new, WA 16,
2,000 movements, 2,008 ITEM/BATCH lock keys (+ ~700 COST keys in the engine), intent 2.5 MB (7 IBA|I rows).

```sh
python3 $K/k2_build.py check
python3 $K/k2_build.py issue                                  # RE-RUN right before (today's balances) -> $F/k2/plan.json, sc_issue.json
$RUNAS $WF_SC $F/k2/sc_issue.json $F/k2/sc_issue.out.json     # WRITE: SC Issued, 2,000 Pending lines -> data.id
python3 $K/k2_build.py review --sc-id <SC id>                 # -> sc_count.json, sa_v2_submit_review.json, (sc_review.json: do NOT run),
                                                              #    review_engine_input.json; prints feasibility + the engine plan (expect 0 problems, PLAN OK)
$RUNAS $WF_SC $F/k2/sc_count.json $F/k2/sc_count.out.json     # WRITE: 2,000 counts -> Completed / To Be Reviewed
python3 $K/reconcile_2k.py snapshot --sc <SC id>              # -> $F/k2/before_<SC id>.json
$RUNAS $WF_SUBMIT $F/k2/sa_v2_submit_review.json $F/k2/submit.out.json   # WRITE: REVIEW -> QUEUED, job_id
sh $K/tick.sh <job_id> $F/k2 12 6                             # WRITES: expect >= 3 ticks: PREPARE -> PARK (READY_TO_COMMIT, due now),
                                                              #   COMMIT A (A0 A1 A2) -> PARK, COMMIT B (A3 A4) -> COMPLETED; a 409 waits 15 s x 2^n
python3 $K/reconcile_2k.py check --sc <SC id> --json $F/k2/reconcile.json
```
Run tick.sh with a long timeout (each 2k tick may take minutes) or in the background. Writes: `stock_count` 1 + 2,000 lines, then
2,000 line updates (count), then per the V2 job: `stock_adjustment` 1 + ~1,162 lines, the engine's rows above, the SC's 2,000 lines
Adjusted + header, ~700 items' last_transaction_date, the job + its S / P parts + steps, IBA|I|001..007 + IBA|DONE.
Check: reconcile_2k -> RECONCILED (job + steps, SA = the approved variances, SC Adjusted, 2,000 keyed movements, every touched
balance / FIFO / WA key moved exactly by the window's movements - other sessions' movements on the same items are counted, node
data per run within CONTRACT §14: SUBMIT / PREPARE <= 25 MB, COMMIT <= 20 MB).

---------------------------------------------------------------------------------------------------------------------------
## If something goes wrong
- An A (classic) answer `code "400"`: stop; that twin is void (the classic is not atomic: read `snap.py` and `.dbtools/wf --dev trace`).
- A B job FAILED (outside F1): nothing moved (phase A); the SA is back to Draft (FORM) / Cancelled (REVIEW). Read `error_code` /
  `error_message`, the WORKER answers in $F/<step>/worker.<job>.tick*.out.json, then `.dbtools/wf --dev trace <instance>`.
- REQUIRES_REVIEW: do NOT re-kick. CONTRACT §9 runbook (clear the engine's IBA|REVIEW, reset the job, re-kick) is the controller's call.
- A snapshot shows a lock held (`snap.py` prints it): find its owner (`owner_operation_id`) before going on.
- `diff_twins` DIFFER: the printed key + columns are the finding; re-run the same command after any fix of the kit only (never re-run
  the twin on the same items without rebuilding both requests from the current state).

## Write count
0a 4 · 0c 1 · 0d 1 · T1 2 (+ 1 tick) · T2 4 (+ 1 tick) · T3 7 (+ 1 tick) · F1 1 (+ 1 tick) · 2k 3 (+ >= 3 ticks) = 23 calls that write +
>= 7 worker ticks (each tick writes); STATUS calls (x5) write nothing. Everything lands on the SAV2T items, their two bins, their documents, and
(2k) one Stock Count of the plant + the clean items it names.
