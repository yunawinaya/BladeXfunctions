# Item Disassembly V2: background completion of big disassemblies

Big Item Disassemblies (IDA) complete in the background on the shared engine INVENTORY_BULK_APPLY instead of the classic IDA_SAVE's
one synchronous request (more than 50 moves = source picks + recovery lines). The classic stays for small IDAs, Draft saves,
handling-unit / serial sources and mobile, capped at 250 moves (IDA_SAVE v7). Binding interface: `scratchpad/idav2/CONTRACT.md`.
Plan: `.superpowers/sdd/there-s-this-item-dissasembly-binary-sonnet/plan.md` (its 3 user decisions are final).

Status (2026-10-21 17:30): ON on dev for Completed; Complete & Post stays classic. Published on dev: batch 1 14:04 (the
guarded classic IDA_SAVE v7, form v36 / list v17 OFF), batch 2 15:32 (folder Save Workflow / IDA: IDA_V2_SUBMIT
`2112748971830149121`, IDA_V2_WORKER `2112749010379997186`, IDA_V2_PREPARE `2112749086439505922`, IDA_V2_COMMIT
`2112749139006717954`, all v3), batch 3 16:18 (form v37 / list v18: `ASYNC_IDA_ENABLED` on, `IDA_V2_ACTIONS { COMPLETE: true,
COMPLETE_POST: false }`), batch 4 17:27 (final-review fixes: COMMIT v4 - big-receipt lease, op-1-skip guard, engine v12's
"same operation is still running" waited on in D2; SUBMIT v4 - first due 600 s; form v38 - the BOM dialog's names HTML-escaped). Live tests 1-7 and 9 passed (classic regression, guards, twins, 830 and 2,000 lines in 711077,
batches, failures, BUSY / double submit / lock wait); 8 (Complete & Post via V2) and 10 (the form at 2,000 lines) are browser
tests that were not run. Ledger with every ruling: `.superpowers/sdd/there-s-this-item-dissasembly-binary-sonnet/progress.md`.

## Files

| File | What | Builder (`scratchpad/idav2/`) |
|---|---|---|
| `IDA_V2_SUBMIT.json` | synchronous entry the form calls (SUBMIT / STATUS): gates, eligibility, the batch-number dry run, the document write, the job | `build_submit.py` (package B) |
| `IDA_V2_WORKER.json` | the tick: claims due COMPLETE_IDA jobs, runs PREPARE, then COMMIT phase A and phase B | `build_worker.py` (C) |
| `IDA_V2_PREPARE.json` | planner: the manifest and its parts ENGINE_I / ENGINE_R (+ alloc) / BATCH / LABELS / ITEMS, both engine PLANs | `build_prepare.py` (A) |
| `IDA_V2_COMMIT.json` | executes the manifest as resumable steps D0-D4 with two engine operations | `build_commit.py` (C) |
| `IDA_SAVE.json` | the guarded classic IDA_SAVE v7 (ships in the cut whatever the switches) | `build_classic.py` (B) |
| `IDAform.json`, `IDAlistPage.json` | the form (from dev v35) and the list (from dev v16); every new or changed script mirrored next to them | `client/build_client.py` (D) |

Build: `python3 scratchpad/idav2/build_ida.py [--write] [NAME ...]` (the publish order), or a package's own builder. Every built
workflow must pass `python3 scratchpad/validate.py <file>`, every SQL node `scratchpad/idav2/lib/sqlcheck.py` on dev (read-only).
Package C's checks: `sh scratchpad/idav2/test/commit/run_all.sh [--sql]`.

## The completion (COMPLETE_IDA)

1. The form's Save as Completed / Complete & Post with more than 50 moves (switches `ASYNC_IDA_ENABLED`, `IDA_V2_ACTIONS`) calls
   IDA_V2_SUBMIT. SUBMIT writes the IDA as `Processing` (with `ida_v2_job_id`), takes the document lock
   `gd_publish_step IDC|<idaId> / LOCK|<n>` and queues a `gd_async_job` (command `COMPLETE_IDA`, correlation `IDA|<idaId>`).
2. The form kicks IDA_V2_WORKER every 15 s while it follows (up to 420 s); the list kicks it once each time the list page opens (at
   most once per 2 minutes per browser, chained while a kick processed a job). There is no periodic kick (no Quartz): a job left
   waiting on a backoff, a lock wait or PARK after the form gave up moves on only when someone opens the list or that IDA, while
   D3's 30-minute receipt window keeps running.
3. One worker tick: claim (`W0_CLAIM_<row_version>`) -> PREPARE (VALIDATING -> READY_TO_COMMIT) -> COMMIT phase A -> COMMIT phase B.
   When either leg holds more than 1,000 movements COMMIT PARKs after phase A (lease cleared, due now) and the next tick runs phase B.
   A tick is one request chain, so above 2,000 moves (the job's `line_count`, `IDA_PREPARE_ALONE_MOVES`) the tick ends right after a
   successful PREPARE (READY_TO_COMMIT, lease released, due now): PREPARE, COMMIT A and COMMIT B then take three ticks (the form kicks
   every 15 s). Measured live at 2,000 lines the biggest tick is ~25.7 MB; ~43-49 MB is projected at the 2,500-line cap (dev's
   single-request crashes start at 59-68 MB).

Two engine operations per job: op 1 `IDC|<jobId>|I` issues the item taken apart (one SUBTRACT per source pick, `M1..Mn`), op 2
`IDC|<jobId>|R` receives every stock-controlled recovery line (one ADD per line, `R1..Rn`) at its share of op 1's stored cost.

### IDA_V2_COMMIT steps (each records `<STEP> DONE`; a rerun skips what is done)

| Step | Phase | Does | Failure |
|---|---|---|---|
| entry | - | reads the job, its D step rows, the D1 intent, the manifest, the IDA's status / job / latest lock and both operations' engine rows in ONE fork-join; claims the lease `PUB|<nonce>` for `min(5400, 600 + ceil(0.6 x movements))` s (2,000 lines = 30 min), or 5,400 s for a phase-B pass of more than 1,000 receipts; a READY_TO_COMMIT claim starts the attempt count at 0 (PREPARE's retries do not shrink D1's retries or D2's lock waits), a resume keeps its own | phase A: bad manifest / IDA not owned -> FAILED (+ Draft when owned, + our Batch rows when a D1 intent exists), but REQUIRES_REVIEW once EITHER operation has engine rows; phase B: IDA not Processing / Completed under this job -> REQUIRES_REVIEW |
| D0_REVALIDATE | A | stored header Processing under this job, the plan's IDA number, `idaLineFingerprint` (DF1: lines, bins, batch numbers, dates, picks, document date) = the plan's | FAILED `IDA_NOT_LOCKED` / `IDA_LINES_CHANGED` + Draft |
| D1_BATCH | A | batch lines only (GR V2 C1): the intent `D1|I|<nnn>` (the generated numbers + the configs before / after) BEFORE any write; the AUTO numbers from a FRESH `batch_number_config` read exactly as N sequential GENERATE_BATCH calls; the configs only forward; the planned Batch rows (ADD_INVENTORY's 11 columns) in slices of 250; read back (incl. the post-insert re-check: no other live org row may hold one of our numbers); the re-PLAN of op 2 with the real batch ids | FAILED + Draft + our Batch rows soft-deleted (the decision table: CONTRACT section 9 rows 1-14) |
| D2_ISSUE | A | op 1 = APPLY `IDC|<jobId>|I`; then the hand-over SPLIT (both legs <= 1,000) or PARK, progress 75, attempt_count 0 | 400 -> FAILED (worded with the pick / item / bin); 409 / no answer -> lock waits 15 s x 2^n (8), then FAILED `IDA_INVENTORY_LOCK_BUSY`; with engine intent rows -> retry, then review; engine v12's 409 "the same operation is still running" (a resumed pass over a live earlier run) -> the same lock waits even with intent rows, then review (never FAILED); 500 -> REQUIRES_REVIEW |
| D3_RECEIPT | B | op 1 DONE, not under review, its stored OUT rows = its code-200 results, no source pick skipped; the issued value = their `total_price` sum (this completion's rows only); `idaAllocate` shares it over EVERY recovery line by quantity (the last line takes the remainder), priced per BASE unit; each receipt's `batch_id` = its Batch row of ours; op 2 = APPLY `IDC|<jobId>|R` (the same request on every retry); progress 80. A receipt answered "401" (its item's stock_control became 0 after both PLANs) is tolerated as op 1's are: DONE, that line's share not received, the keys named in the DONE ref (`skipped`, `skipped_count`) and on the job's progress message | 409 / no answer -> 10 s waits (not counted) up to 30 min after D3's first transient answer, then REQUIRES_REVIEW `IDA_RECEIPT_TIMEOUT`; any other receipt code than "200" / "401" (or a missing one), op 2 400 / 500 -> REQUIRES_REVIEW `IDA_RECEIPT_REFUSED`; count off -> `IDA_RECEIPT_COUNT_MISMATCH` |
| D4_FINISH | B | the generated numbers into the AUTO lines' `batch_number` (the line collection, slices of 250), Item `last_transaction_date` (the source + every recovery item, slices of 250, one ISO stamp), then the header `Completed` / `posted_status Unposted` LAST (the unlock) | retries, then REQUIRES_REVIEW |
| finish | B | job COMPLETED, progress 100 | |

Phase A never moves stock before D2, so its failures are clean: FAILED, the IDA back to Draft (only while the job owns it and
`prevStatus` is Draft; never a default), this job's own Batch rows soft-deleted in slices of 250 - in that order (unlock -> Batch
rows -> job): once the IDA is Draft a resumed run fails at the entry and never calls the engine again. Once either operation has an
engine row (`IBA|I|`, `IBA|REVIEW` or `IBA|DONE` under `IDC|<job>|I` / `|R`), every phase-A failure is written as REQUIRES_REVIEW
`IDA_RECONCILIATION_MISMATCH` instead (`error_details.wouldFail` = the code it would have been): no unlock, no soft-delete. Phase B
never unlocks and never fails: it retries and then goes to REQUIRES_REVIEW with the IDA left Processing. The batch number
counters stay advanced after a FAILED job (as the classic: GENERATE_BATCH never gives a number back).

"Ours" (the Batch rows this job inserted) = the live org Batch rows with `id > <jobId>`, this IDA's number as `transaction_no`
and the identity (number compared as utf8mb4_general_ci, material, plant) of a planned BATCH row that inserts; a planned identity
held by k rows owns its k lowest ids. It is re-derived from the table each time (BATCH part + D1 intent + `BATCH_OURS`, or D1's
`BATCH_HOLDERS` read), never stored.

Progress the form reads: QUEUED 0, VALIDATING 10, READY_TO_COMMIT 60, phase A 70 ("Issuing the item being disassembled (<n> source
picks)"), source issued 75, components received 80 (both operations moved stock), finishing 85, COMPLETED 100, FAILED /
REQUIRES_REVIEW 0.

### IDA_V2_WORKER

`lib/v2build.build_worker` (GR V2's worker) with the IDA config: polls `COMPLETE_IDA` only (at most 5 due jobs per tick, oldest first,
20 s budget), lock join on `sm_item_disassembly` (`AND g.is_deleted = 0`) + the latest `IDC|` LOCK row (correlation offset 5), unlock =
`{ id, item_disassembly_status: prevStatus }` only while the job owns the IDA and prevStatus is Draft (otherwise REQUIRES_REVIEW
`IDA_PREV_STATUS_UNKNOWN`, no unlock). Hard codes (FAILED at once, no retry): `IDA_INVALID_REQUEST`, `IDA_INVALID_DATA`, `IDA_NOT_FOUND`,
`IDA_NOT_LOCKED`, `IDA_NOT_ELIGIBLE`, `IDA_LINES_CHANGED`, `IDA_SPLIT_REQUIRED`, `IDA_PLAN_BROKEN`, `IDA_PLAN_SKIPPED`, `IDA_BATCH_CONFIG`,
`IDA_BATCH_DUPLICATE`, `JOB_ILLEGAL_TRANSITION`. A callee answering without a code, or a run that died (dead lease / claim), is retried
(2 s x 2^n, at most 3); exhausted: FAILED + Draft before COMMIT started, REQUIRES_REVIEW once COMMITTING_IDA. Chain budget: after a successful
PREPARE of a job above `IDA_PREPARE_ALONE_MOVES` (2,000, defined in the worker's own JS) the worker writes the job READY_TO_COMMIT with the
lease released and due now, and ends the tick (path `PREPARED`; a later due job waits for the next tick); the next kick claims it straight
for COMMIT.

### Deliberate differences from the classic save

- One engine operation per leg instead of one child call per pick / line; both legs all-or-nothing, resumable, replayed on a rerun
  (`operation_effect_key` = `IDC|<job>|I|M<k>` / `|R|R<k>` on every movement row).
- The receipt is priced per BASE unit of the recovered item (the engine's and ADD_INVENTORY's rule; the classic v7 has the same fix):
  a non-base-UOM line is received at its line value, not factor x its cost.
- The issued value sums only THIS completion's OUT rows (op 1's operation key), never an earlier cycle of a re-completed IDA.
- No blank Batch row per non-batch line (the classic mints one per line); a typed number shared by lines of one item -> ONE Batch row
  (initial_quantity = the lines' base-qty sum, dates / remarks from the first such line); an AUTO line -> its own row.
- A typed number already held by a live Batch row of the organization is refused case-insensitively (trailing spaces ignored) on
  every TYPED line of a stock item: by SUBMIT at the click (STOP 400 `IDA_INVALID`, code_validate's wording), then again by PREPARE
  and D1 for races (GENERATE_BATCH's semantics); the classic `code_validate` compares exactly and only on items with manual numbering (`item_batch_management === 1` and
  `batch_number_genaration !== 'According To System Settings'`). A number taken by another writer
  between SUBMIT and PREPARE fails at PREPARE as `IDA_INVALID` ("... already exists: nothing was moved."); one taken between PREPARE
  and D1 fails at D1 as `IDA_BATCH_DUPLICATE`.
- A non-stock AUTO line consumes a generated number (written into the line, no Batch row) - as the classic, where GENERATE_BATCH ran
  for it and ADD answered 401. Non-stock lines keep their share of the issued value and receive nothing (classic parity: the value of
  a non-stock line, also the LAST one, is not received).
- The generated numbers reach the lines in D4 (phase B), after both operations; a phase-A failure leaves the placeholders (the
  numbers stay consumed).
- A receipt the engine skips with "401" (its item became non-stock after both PLANs) is not received and the job completes - as the
  classic ADD answers 401 and carries on; V2 names the skipped receipts in D3's DONE row and on the COMPLETED job's message. Such a batch
  line keeps its generated number and its Batch row (no stock on it; the classic would have made none).
- HU picks, a serial source item and picks outside Unrestricted / Blocked stay on the classic save (SUBMIT answers NOT_ELIGIBLE up to
  250 moves, STOP above).

## The classic IDA_SAVE v7 (package B; ships whatever the switches)

`Item Disassembly/AsyncV2/IDA_SAVE.json` = live dev **v6** (`base/IDA_SAVE.v6.json`, md5 `e79c2d2e7de55f8e232612d9e9ef6c4b`,
workflow `2107305535347552257`) + exactly **two** changes (CONTRACT.md section 11, user decision 3). It ships with the promotion
whatever the V2 switches say. Every other v6 node is byte-identical (`classic/diff_v6.py`).

### Change 1: the IDA V2 guard, the first nodes after `start`

`code_node_IDAguardIn` -> `if_IDAguardRead` [`sql_node_IDAguard` -> `code_node_IDAguardStored` -> `if_IDAguard400` / `if_IDAguard409`]
-> `if_IDAguardBig`. The returns are copies of v6's `return_required_400` / `return_idem_409` (status 200, `{ code, message }`).
400 or 409, never 401.

| When | Answer |
|---|---|
| Edit with a digit `allData.id` (and a digit session tenant), stored `Processing` (any saveAs) | 400 "This Item Disassembly is being processed in the background - please wait for it to finish." |
| Edit, stored `Completed` / `Fully Posted`, saveAs `Draft` (the stale-tab bug: v6 wrote the IDA back to Draft) | 409 "This Item Disassembly is already <status> and cannot be saved again." (= v6 `code_idem_guard`'s text) |
| any page, saveAs not `Draft`, more than 250 moves (source picks with `sm_quantity > 0` + recovery lines with an item) | 400 "This Item Disassembly has <n> source picks and recovery lines - too big for the classic save, which handles at most 250 at once. Complete it from the web form with background completion switched on, or split it into smaller disassemblies." |

Only an Edit reads the stored status (one SQL, `CLASSIC_GUARD`: `sm_item_disassembly` only, tenant-scoped); an Add, a Clone / Copy
(it may carry the source id) and a Draft save of a big IDA read nothing. The guard reads no V2 table and no stored pick count. Its
code is `code/shared/ida_common.js` (the moves count and texts SUBMIT and the client share) + `classic/guard_in.js` /
`guard_stored.js`.

### Change 2: `code_cost_alloc` prices per BASE unit

`unit_price: qty > 0 ? q8(lineValue / qty) : 0` becomes `unit_price: baseQty > 0 ? q8(lineValue / baseQty) : 0`, with `baseQty` =
ADD_INVENTORY v65's own conversion of the line (`code_node_mvszWJ8p`): `alt = line.quantity_uom || item.based_uom` on the item's
`search_items` row, the first `table_uom_conversion` row whose `alt_uom_id` equals `alt` (as text), `baseQty = q8(qty x base_qty)`, else
`qty`. ADD books `total_price = q8(unit_price x baseQty)` = the line value up to q8; v6 booked `factor x` the line value on a non-base-UOM
line. A base-UOM line is priced exactly as before. The quantity share, the last-line remainder, `issuedValue` (its trx_no read), the
receipt fields and the HU / Item-stamp nodes are unchanged.

Verified on dev: `search_items` rows carry `table_uom_conversion` with `alt_uom_id` / `base_qty`, and at run time `code_cost_alloc`
sees the ids as exact 19-digit text (its recorded output, run 2110985743831793666), as ADD's child requests show - so the text compare
equals ADD's `===`.

### Not changed (deliberately)

The GENERATE_BATCH loop and its Redis array, the blank Batch row per non-batch line, `code_idem_guard`, the 401 / 402 answers, the
header written Completed before stock moves.

### Build, prove, test

```
python3 scratchpad/idav2/build_classic.py --write                # or build_ida.py IDA_SAVE
python3 scratchpad/idav2/classic/diff_v6.py                      # node-by-node proof: PROBLEMS 0
python3 scratchpad/idav2/lib/lift/lift.py scratchpad/idav2/classic/lift_v7.json   (lift_v6.json, lift_add.json once)
node scratchpad/idav2/classic/test_v7.js                         # v7 bodies vs v6 on the recorded dev runs, the price fix through ADD's own bodies, the guard bodies
node scratchpad/idav2/classic/test_guard_sim.js                  # v7 and v6 side by side on the FlowGram interpreter
python3 scratchpad/idav2/classic/mutants_v7.py                   # every mutant of the two changes is caught
python3 scratchpad/validate.py "Item Disassembly/AsyncV2/IDA_SAVE.json"
```

Before the publish: `python3 scratchpad/idav2/base/snapshot.py --check` (live dev must still be v6, else rebuild on the new base), a
`base` guard in the wf_upload plan, and the classic regression of the plan's verification 1-2.

## The client: form + list (package D)

Built by `scratchpad/idav2/client/build_client.py` from the live dev form v35 (`base/ida_form_v35.json`, md5 `86100240...`) and
the list's current dev row, zhenxiang's designing v17 (`base/ida_list_v17d.json`, md5 `0f244e67...` = enabled v16 + two designer
defaults; wf_upload's base guard compares against it); the build stops if either base changed. Paste / publish files:
`Item Disassembly/AsyncV2/IDAform.json`, `IDAlistPage.json`; every new or changed script is mirrored next to them
(`idaV2_*.js`, `idaForm_*.js`, `idaList_*.js`). Regression: `node scratchpad/idav2/client/check_all.js`.

### Switches (constants in the scripts; rebuilt, never hand-edited)
| Switch | Where | OFF |
|---|---|---|
| `ASYNC_IDA_ENABLED` + `IDA_V2_ACTIONS { COMPLETE, COMPLETE_POST }` | Completed / Complete & Post buttons, form mounted (`IDA_BG_ENABLED`), list kick | every click runs the classic handler, byte-identical; no V2 call, no browser storage |

`python3 build_client.py --write` builds OFF (the first publish) and an ON preview in `client/out/on/`.
`--on[=COMPLETE,COMPLETE_POST] --write` writes that ON build to the repo and is refused while `ids.json` holds "0" for
IDA_V2_SUBMIT / IDA_V2_WORKER (nothing written). At run time a click stays classic unless the switch, its action and both ids
are set. Rollback without a rebuild: bind `button_completed` back to `onClick_saveAsCompleted` (key `iasvcomp`) and
`comp_post_button` to `onClick_saveAsCompletedPost` (`aymq6q8z`).

Dev runs the `--on=COMPLETE` build (batch 3). Back to OFF: publish `scratchpad/idav2/deploy/base_off/` (the batch-1 OFF build; it predates the BOM-dialog escape, harmless when OFF since the V2 handler then never runs its dialog)
with `deploy/wf_upload.ida.batch3.plan.json`'s items pointed at it, or the backups `workflow-backups/dev/IDA form (ON)/v36_*`
and `IDA list (ON)/v17_*`.

### What the client does
- Completed / Complete & Post: V2 (IDA_V2_SUBMIT) when the switch and action are on, the page is Add / Clone or an Edit of a
  stored Draft, more than 50 moves (source picks with `sm_quantity > 0` + recovery lines with an item), no handling unit
  (a pick's `handling_unit_id`, `temp_hu_data`, `table_hu`) and no serial-numbered pick; anything else, a NOT_ELIGIBLE /
  INVALID answer or an error before SUBMIT -> the classic handler (once). IDA's own `validateForSave` (it lets the stock
  dialog's rules and Batch No's asterisk through) and the BOM-variance confirm run first, both lifted from the classic:
  `validateForSave` verbatim, the BOM-variance confirm with exactly its three names HTML-escaped (`idaEscHtml`: the line's item
  name, the removed component's name / code, the BOM version - the dialog renders HTML). The classic handlers (`iasvcomp` /
  `aymq6q8z`) stay byte-identical and still show those names unescaped (pre-existing; reported to the user).
- The idempotency key `IDA:<org>:<id | new-<page token>>:<hash16>:<gen>` covers the record minus the form's own keys
  (badges, buttons, layout, the stock dialog, `item_display_table`, `ida_source_stock_mode`, `ida_v2_job_id`, `ida_idem_key`,
  `dialog_*`); both buttons send the same key; a FAILED job moves to the next generation. A click claims `ida_submitting` before
  its first await (a second click is refused) and every exit releases it. A lost answer, STOP 500, the
  platform's error envelope or an unlinked Add keeps the key for the next click (and hides Save as Draft on an Add).
- The verdict: COMPLETED, or (no post) COMMITTING_IDA at 80 % (both legs moved) -> the form closes and the worker is kicked
  up to 10 more times. Complete & Post posts with the classic `postToAccounting` code, verbatim, only on COMPLETED (never on
  an "already completed" STATUS answer), once per job: this browser's `localStorage ida_v2_posted_<jobId>` mark, then the stored
  status / posted_status (Completed + Unposted / Failed Post / blank) - a second tab or browser on the same Draft follows the same job; if the 420 s wait ends first: "Still completing in the background; post it from the
  list once it shows Completed." With `COMPLETE_POST` off (and `COMPLETE` on) a big Complete & Post completes in the
  background and is posted from the list.
- A Processing IDA opens read-only (Processing badge, header and components locked, no save / post button, a message). With
  the switch on it follows the job (STATUS every 3 s, a worker kick every 15 s, 420 s). A failed job is shown once per
  browser (`localStorage ida_v2_failed_seen_<jobId>`).
- Post (the form's Post and the list's bulk Post) re-reads the stored status and writes Pending Post only for a Completed
  disassembly that is Unposted / Failed Post / blank; a stale form or grid row is refused / named in a warning.
- List: the first `mounted` kicks IDA_V2_WORKER (on its switch and id, at most every 2 minutes per browser, chained while
  `processed > 0`, at most 40 rounds); Edit is hidden for a Processing row; Delete refuses Processing (and re-reads the stored
  status after the confirm).
- 2,000 lines (whatever the switch): the BOM explode reads Items with `.field()` (only the 9 columns it reads, which also
  prunes the Item subform joins), in 500-id chunks with `.limit(<chunk>)`, re-asking for the ids a clamped answer left out;
  its UOM / default storage / default bin / source balance / HU reads carry explicit limits. Its per-row option / disabled
  loop, the Batch Add and item-picker handlers and mounted's per-row loops are unchanged (measured: `client/out/measure.txt`).

### Limits
- **Posting** (user decision 2, unchanged fetches): SQL_FETCH_POST_DATA v225 / ATC_FETCH_POST_DATA v146 refuse more than
  1,000 distinct item / UOM / plant / project / bin / batch ids ("Too many reference IDs; split the task"): an IDA above
  ~1,000 recovery items cannot be posted. They also refuse a recovery `batch_number` of `-` or `Auto-generated batch number`
  ("not resolved by the save workflow"): an IDA with a non-batch recovery line cannot be posted on either path (flag F1).
- At 2,000 lines the per-row `disabled` / `setOptionData` calls stay as the base makes them (explode 6,001 disabled paths,
  Batch Add of 2,000 items 12,000, opening a 2,000-line Draft 5,999); GR's finding (the runtime copies its state map per
  path, 14k paths ~21 s) suggests a freeze of seconds there - to be timed in the browser (plan verification 10).
- Mobile still uses the classic save (the guarded classic refuses Processing).

## Known gaps (reported to the user, not changed)

- A double click on Completed for a SMALL IDA (classic path, <= 50 moves) can run two classic saves on an Add (two IDAs): the
  classic handlers are byte-identical and v7's stored-status guard is Edit-only (pre-existing; IA has the same gap).
- The classic GENERATE_BATCH resolves the organization from the session global `firstLvDeptId`; a run without a session (the
  minted-token test route) answers "No default batch found.". The form path works (10-16 IDA-2610-003). V2 never calls it.
- At 2,000 lines the form's per-row option / disabled loops are unmeasured in a browser (plan verification 10 skipped).
- Two auto-batch IDA completions whose D1 steps overlap in one organization both fail `IDA_BATCH_DUPLICATE` ("Duplicate Batch
  Format found."): nothing moved, both back to Draft, two numbers burned, a second click works (seen live 10-21, Batch-00641).
  Never a duplicate. The fix is a numbering hold row per `batch_number_config`; offered as a follow-up.
- A big receipt holds its lock keys for minutes (2,000 lines: ~4,000 keys for ~8.5 min on today's dev); another V2 document
  receiving one of those items waits (`IDA_WAIT`, 10 s retries, up to 30 min) and then completes (seen live 10-21).

## Limits

| Limit | Value | Where |
|---|---|---|
| V2 route | more than 50 moves (`IDA_V2_MIN_MOVES`) | client |
| classic Completed cap | 250 moves (`IDA_CLASSIC_MAX_MOVES`); above it V2 or STOP `IDA_TOO_BIG` | IDA_SAVE v7, SUBMIT |
| per leg | at most 2,500 source picks and 2,500 stock recovery lines (`IDA_V2_MAX_LEG`, STOP `IDA_SPLIT_REQUIRED` "please split"); PREPARE keeps 5,000 (`IDA_MAX_MOVES`, the engine's request cap) as a backstop | SUBMIT, PREPARE |
| PARK | phase B on the next tick when op 1 OR op 2 holds more than 1,000 movements | COMMIT D2 |
| COMMIT lease | `min(5400, 600 + ceil(0.6 x movements of both legs))` s from the DB clock (2,000 lines = 1,801 s); a phase-B pass of more than 1,000 receipts (`IDA_PARK`) takes 5,400 s, because a COMMIT B outliving its lease would be resumed into a second APPLY of the same engine operation (live 2,000-line COMMIT B: 620 s). Engine v12 (dev 10-21 17:12) also refuses a second APPLY of an operation still running (409 "the same operation is still running" while its heartbeat is under 20 min; D3 waits it out) | COMMIT entry |
| first due | the job is inserted due in 600 s; SUBMIT's last write (`due`) makes it due at once, so only a SUBMIT that died before that waits (it then self-heals: PREPARE completes a fully written submit or FAILs an unlinked one) | SUBMIT |
| D3 wait | 10 s waits, not counted, up to 1,800 s after D3's first transient answer | COMMIT D3 |
| node data | measured on the interpreter (outputs + recorded inputs): 2,000 lines A 11.6 MB / B 9.5 MB; 5,000 lines A 28.3 MB / B 23.3 MB (target <= ~35 MB per run). Live on dev 10-21, 2,000 lines: SUBMIT 5.52 MB, PREPARE 7.35 MB, COMMIT A 1.54 MB, COMMIT B 4.35 MB, engine op 2 21.30 MB (508 s); 830 lines: engine op 2 10.65 MB | `test/commit/commit_sim.js` |
| chain budget | a worker tick is one request chain: above 2,000 moves PREPARE runs alone in its tick; at 5,000 moves the ticks are PREPARE (+ 0.1 MB worker), COMMIT A 28.4 MB, COMMIT B 23.4 MB (worker + nested COMMIT, interpreter). Live 2,000 lines: tick 1 (PREPARE + 2 PLANs) ~11.7 MB, tick 2 (COMMIT A, PARK) ~1.7 MB, tick 3 (COMMIT B + engine op 2) ~25.7 MB, 621 s; 2,500 lines projects to ~43-49 MB against dev's 59-68 MB single-request crash sizes | `test/commit/e2e_sim.js` |
| posting (Complete & Post, list Post) | the posting fetch (SQL_FETCH_POST_DATA v225, unchanged - user decision 2 / 4) refuses more than 1,000 distinct item / UOM / plant / project / bin / batch ids: an IDA above ~1,000 recovery items cannot be posted; the list Post takes 1-100 IDAs | fetch owner |
| posting a non-batch line | the same fetch refuses a recovery `batch_number` of `-` or the placeholder ("not resolved by the save workflow"): an IDA with any non-batch recovery line cannot be posted on either path (flag F1, outside V2) | fetch owner |

## Error codes (COMMIT and WORKER; SUBMIT's and PREPARE's: CONTRACT section 10)

| Code | Job | Meaning (the message the user reads) |
|---|---|---|
| IDA_NOT_LOCKED | FAILED | "The Item Disassembly is no longer locked by this completion: nothing was moved." |
| IDA_LINES_CHANGED | FAILED | "The Item Disassembly's lines changed while it was waiting: nothing was moved, please complete it again." (D0: number / fingerprint) |
| IDA_INVALID_DATA | FAILED | the prepared data is unusable (manifest, a part, a BATCH row): nothing was moved |
| IDA_BATCH_CONFIG | FAILED | D1: GENERATE_BATCH's own refusal (`No default batch found`, `<X> Date is required`, ...) or a configuration of the intent gone, + ": nothing was moved" |
| IDA_BATCH_DUPLICATE | FAILED | D1: "Duplicate Batch Format found. (batch number <n>) Nothing was moved." (a generated number, or one of ours taken by another writer before / after the insert); a typed number taken since SUBMIT: "Line <i> (<item>): Batch No <n> already exists. Nothing was moved." |
| IDA_BATCH_FAILED | FAILED | "The Batch rows of the recovered items could not be created (<why>): nothing was moved, please complete it again." (inserted twice / missing after 3 retries / configuration behind) |
| IDA_PLAN_SKIPPED, IDA_INVENTORY_<code>, IDA_PLAN_FAILED | FAILED | D1's re-PLAN of op 2 or op 1 (D2) refused; the message names the pick / line, item and bin |
| IDA_INVENTORY_LOCK_BUSY | FAILED | "The stock of the item being disassembled stayed locked by another operation: nothing was moved, please try again later." |
| IDA_TRANSIENT_RETRIES_EXHAUSTED | FAILED | the worker: "Temporary failures persisted; not completed." |
| IDA_RECEIPT_COUNT_MISMATCH | REQUIRES_REVIEW | D3: op 1 not DONE / under review, its stored OUT rows differ from its code-200 results, or it skipped a source pick (the engine's "401": nothing was issued for it): op 2 not started |
| IDA_RECEIPT_REFUSED | REQUIRES_REVIEW | D3: a receipt answered other than "200" / "401" (a "401" skip is tolerated: DONE, named), or none, or op 2 answered 400 / 500 |
| IDA_RECEIPT_TIMEOUT | REQUIRES_REVIEW | D3: op 2 locked out for 30 min after its first transient answer |
| IDA_RECONCILIATION_MISMATCH | REQUIRES_REVIEW | "Under review: the completion stopped half-way. Please contact support." - a step after op 1 did not complete, op 1 answered 500, a COMMIT run died 3 times, an unreadable D1 intent, or a phase-A failure after an engine operation wrote |
| IDA_PREV_STATUS_UNKNOWN | REQUIRES_REVIEW | "Under review: the status to restore is unknown. Please contact support." - nothing unlocked |
| IDA_LOCK_WAIT, IDA_WAIT, IDA_STEP_RETRY, IDA_TRANSIENT | open job | waiting / retrying (progress message only) |
| JOB_ILLEGAL_TRANSITION, JOB_ROW_VERSION_CONFLICT | (answer only) | the run found the job in another state / under another run's lease: nothing written |

## Processing under a terminal job (no REVIEW)

Seen only when SUBMIT's document write landed after its job had already ended (a platform stall longer than the 600 s first due):
the IDA is `Processing`, its `ida_v2_job_id` job is FAILED or COMPLETED, and the job moved nothing. Every V2 click answers BUSY,
the classic answers busy and the list refuses Delete. Check it (read-only; `<t>` tenant, `<ida>` IDA id):
```sql
SELECT CAST(h.id AS CHAR) AS ida, h.stock_movement_no, h.item_disassembly_status, CAST(j.id AS CHAR) AS job, j.job_status, j.error_code,
  (SELECT COUNT(*) FROM inventory_movement m WHERE m.tenant_id = h.tenant_id AND m.operation_effect_key LIKE CONCAT('IDC|', j.id, '|%')) AS moved,
  (SELECT COUNT(*) FROM gd_publish_step p WHERE p.tenant_id = h.tenant_id AND p.job_id IN (CONCAT('IDC|', j.id, '|I'), CONCAT('IDC|', j.id, '|R'))) AS steps
  FROM sm_item_disassembly h JOIN gd_async_job j ON j.tenant_id = h.tenant_id AND j.id = CAST(h.ida_v2_job_id AS UNSIGNED)
 WHERE h.tenant_id = '<t>' AND h.id = <ida> AND h.item_disassembly_status = 'Processing' AND j.job_status IN ('FAILED', 'COMPLETED');
```
`moved` and `steps` both 0: set the header back to Draft (`item_disassembly_status = 'Draft'`, the job's own unlock) - a support write, one yes each
(dev: `.dbtools/dbw`) - and the user completes it again. `moved` or `steps` above 0: an engine row exists, use the REVIEW runbook below instead.

## REQUIRES_REVIEW runbook (CONTRACT section 9)

A job in REQUIRES_REVIEW leaves the IDA `Processing` (the classic save, SUBMIT and the list refuse it) and the engine keeps the locks
of an operation under review (they block GD / GR / SA / Putaway / IA V2 on those items) until someone resolves it. Dev: the user runs
every write with `.dbtools/dbw`, one yes each. Prod is SELECT-only: the same changes go through the platform by the user / support,
never by a session.

1. Read the job, both operations' rows and the locks (`<t>` tenant, `<job>` job id, `<ida>` IDA id, `<org>` organization):
   ```sql
   SELECT CAST(id AS CHAR) AS id, job_status, error_code, error_message, error_details, progress_percent, attempt_count, lease_owner, next_attempt_at
     FROM gd_async_job WHERE tenant_id = '<t>' AND id = <job>;
   SELECT CAST(id AS CHAR) AS id, job_id, step_name, step_status, LEFT(result_ref, 300) AS ref, error_message, finished_at
     FROM gd_publish_step
    WHERE tenant_id = '<t>' AND job_id IN ('<job>', 'IDC|<job>|I', 'IDC|<job>|R', 'IDC|<ida>') AND is_deleted = 0 ORDER BY id;
   SELECT lock_key, owner_operation_id, claimed_at FROM inventory_balance_lock
    WHERE tenant_id = '<t>' AND owner_operation_id IN ('IDC|<job>|I', 'IDC|<job>|R');
   ```
   `error_details.step` names the step; the job's own rows are `D0_` .. `D4_`, the intent `D1|I|001` and the parts `P|<nonce>|...`;
   each operation has `IBA|I|nnn` (intents), `IBA|DONE` (`{results, summary}`) or `IBA|REVIEW`. This job's Batch rows:
   ```sql
   SELECT CAST(b.id AS CHAR) AS id, b.batch_number, CAST(b.material_id AS CHAR) AS material_id, b.initial_quantity
     FROM batch b
    WHERE b.tenant_id = '<t>' AND b.organization_id = '<org>' AND b.id > <job> AND b.is_deleted = 0
      AND b.transaction_no = (SELECT h.stock_movement_no FROM sm_item_disassembly h WHERE h.tenant_id = '<t>' AND h.id = <ida>);
   ```
2. **Op 1 under review** (`IDC|<job>|I` has `IBA|REVIEW`; D2 not DONE): fix the cause, soft-delete that `IBA|REVIEW` row, reset the
   job (step 7), kick the worker: COMMIT resumes at D2 (the engine resumes from its own intent) - op 2 can never start first (D3
   refuses while op 1 is under review or not DONE).
3. **Op 1 DONE, D3 stopped** (`IDA_RECEIPT_COUNT_MISMATCH`, `IDA_RECEIPT_TIMEOUT`, a 400 / 500, or op 2's `IBA|REVIEW`): check op 1's
   stored OUT rows against its DONE summary
   (`SELECT COUNT(*), SUM(total_price) FROM inventory_movement WHERE tenant_id = '<t>' AND id > <job> AND is_deleted = 0 AND
   organization_id = '<org>' AND movement = 'OUT' AND transaction_type = 'IDA' AND operation_effect_key LIKE 'IDC|<job>|I|%'`), fix
   the cause (a 400: the receipt bins' balance rows; a timeout: the operation holding the receipts' lock keys), soft-delete op 2's
   `IBA|REVIEW` if any, reset the job, kick: COMMIT resumes at D3 with the same prices and the same request.
   `IDA_RECEIPT_TIMEOUT` counts 30 minutes from D3's FIRST transient answer (`error_details.waitFrom`), not from D2: the reset
   clears it, so the resumed D3 gets a fresh 30-minute window (clear the blocker first anyway).
4. **A receipt skipped with "401"** is NOT a review: the job completes (classic parity) and names it - the `D3_RECEIPT` DONE row's
   `result_ref` holds `skipped` / `skipped_count`, the COMPLETED job's `progress_message` ends "(N receipt(s) skipped, stock control 0:
   R..)". That line's share of the issued value was not received; if the business wants it, receive it by hand (its value = the line's
   share of the OUT total above, per base unit). `IDA_RECEIPT_REFUSED` (a review) is any other per-receipt code or a missing result: check
   op 2's `IBA|DONE` / `IBA|REVIEW` rows - if op 2 applied, the receipts with code "200" are in; fix the cause and, when op 2 is DONE, record
   `D3_RECEIPT` DONE by hand (`gd_publish_step`: job_id `<job>`, step_name `D3_RECEIPT`, step_status `DONE`) and reset: COMMIT resumes at D4.
5. **Op 1 moved stock but the IDA is no longer Processing / Completed under the job** (e.g. deleted by an old mobile client): after
   D2 the entry reviews it; before D2 DONE (a run died right after op 1's APPLY, then the IDA lost its lock) the failure COMMIT would
   have written is in `error_details.wouldFail` with `step` `D2_ISSUE`. The item was issued (op 1's `IBA|DONE`, OUT rows) and the
   components were not received; decide with the business whether to restore the IDA (`is_deleted = 0`, Processing under the job)
   and reset the job (COMMIT resumes at D2, op 1 answers REPLAYED, then D3), or to put the stock back by hand.
6. **`IDA_PREV_STATUS_UNKNOWN`** (phase A, nothing moved) or **an unreadable D1 intent** (`IDA_RECONCILIATION_MISMATCH`, step
   `D1_BATCH`, no engine row): correct the request's `prevStatus` to `Draft` and reset, or end it: job FAILED, the IDA `Draft`, and this
   job's Batch rows (the query in step 1, the ones whose number / item are the BATCH part's planned rows) soft-deleted. The numbers stay
   consumed; the next click gets new ones.
7. Reset (dev):
   ```sql
   UPDATE gd_async_job SET job_status = 'COMMITTING_IDA', attempt_count = 0, lease_owner = NULL, lease_expires_at = NULL,
          next_attempt_at = NOW(3), error_code = NULL, error_message = NULL, error_details = NULL, finished_at = NULL
    WHERE tenant_id = '<t>' AND id = <job>;
   ```
   then IDA_V2_WORKER `{ "job_id": "<job>" }` (clearing `error_details` also restarts D3's wait window). Never soft-delete one of the
   job's own `D*` rows to redo a step: the unique `Job Step` index (tenant, job_id, step_name) includes deleted rows, so the re-insert
   would fail the run.

## Tests (package C)

`sh scratchpad/idav2/test/commit/run_all.sh [--sql]` builds both workflows and runs, in UTC+8 (as the platform runs batchnum):
`test_steps.js` (every step decision loaded from the BUILT nodes: after-value = done, before-value = write, else per the tables; the
D1 rows 1-14; the exit order; declared types), `commit_sim.js` (the BUILT COMMIT on `lib/sim` with the deployed planner of
`base/INVENTORY_BULK_APPLY.v10.json`: happy paths non-batch / TYPED shared number / AUTO / mixed / alt UOM / non-stock last line /
Fixed Cost / WA; a crash after every write and the resume; every D1 row; D2 400 / 409 x 8 / envelope / 500; D3 409 to the deadline,
op 1 under review, count mismatch, a 401 receipt, 400 / 500; the IDA deleted before D0 and after D2; PARK on either leg; node data at
2,000 and 5,000 lines), `worker_sim.js` (the BUILT WORKER), `e2e_sim.js` (the BUILT WORKER driving the BUILT COMMIT), the linter, the
JS syntax check; `--sql` runs every SQL node read-only on dev.

Not yet updated: the engine base pin and the `test/integration/world.js` mocks are still INVENTORY_BULK_APPLY v10, while dev runs v12
(v11 15:40 10-21: a replay releases its locks; v12 17:12: a run marker refuses a second concurrent APPLY of one operation; the caller
contract is unchanged; the engine owner ran our full e2e on v11 and on v12 copies: all passed, no lock held). v12's harness needs mocks for
`sql_node_IBrunMe`, `sql_node_IBfence`, `sql_node_IBfzRel`, id / heartbeat in `sql_node_IBops` and db_now in `sql_node_IBlk3`. The live kit's
`diff_twins_ida.py --nothing-moved` can falsely fail when another document holds the same typed batch number.
