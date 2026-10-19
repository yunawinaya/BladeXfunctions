# Item Assembly V2: background completion and revert

Big Item Assemblies complete in the background on the shared engine INVENTORY_BULK_APPLY instead of the classic IA_SAVE's one
synchronous request (more than 50 stock picks), and big Completed IAs are reverted to Draft in the background from the list's
"Revert Completed" (more than 50 live stock rows). The classics stay for small IAs, Draft saves, handling-unit / serial IAs and
mobile, capped at 250 (IA_SAVE v12: stock picks of a completion; IA_REVERT v5: component rows of a revert, i.e. the picks - the
receipt row is not counted, so an IA completed with 250 picks stays revertible; ruling 10 R1). Binding interface:
`scratchpad/iav2/CONTRACT.md` (completion: sections 1-14; Revert V2: RV1-RV10). Plan: `~/.claude/plans/cheeky-shimmying-puffin.md`.

Status (2026-10-19): built and tested in the builder folder `scratchpad/iav2/`; NOTHING published. Shell ids are `"0"` in
`scratchpad/iav2/ids.json` until the user creates the 8 dev designer shells; rebuild with the real ids before any publish. The
integration checks (Task F) ran every built workflow end to end with stand-in ids held in memory (see Tests).

## Files

| File | What | Builder (`scratchpad/iav2/`) |
|---|---|---|
| `IA_V2_SUBMIT.json` | synchronous entry the form calls (SUBMIT / STATUS): gates, eligibility, the document write, the job | `build_submit.py` (package B) |
| `IA_V2_WORKER.json` | the tick: claims due COMPLETE_IA jobs, runs PREPARE, then COMMIT phase A and phase B | `build_worker.py` (C) |
| `IA_V2_PREPARE.json` | planner: the manifest and its parts ENGINE_I / ENGINE_R / BATCH / LABELS / ITEMS, both engine PLANs | `build_prepare.py` (A) |
| `IA_V2_COMMIT.json` | executes the manifest as resumable steps I0-I4 with two engine operations | `build_commit.py` (C) |
| `IA_SAVE.json` | the guarded classic IA_SAVE v12 (ships in the cut whatever the switches) | `build_classic.py` (B) |
| `IA_REVERT_V2_SUBMIT.json` | synchronous entry the list calls (SUBMIT / STATUS): the classic's refusals on the stored IA (its own prep, lifted), size and eligibility routing, then the lock, the job and the header Processing | `build_revert.py` (F) |
| `IA_REVERT_V2_WORKER.json` | the tick: claims due REVERT_IA jobs (at most 5 per tick, 20 s budget), runs PREPARE, then COMMIT phase A and phase B | `build_revert.py` (F) |
| `IA_REVERT_V2_PREPARE.json` | planner: the classic's reads without row caps, its `code_node_iaRvParams` / `_iaRvPrep` / `_iaRvBuild` lifted verbatim, the parts ENGINE / COST / BATCH / HDR / LABELS, the engine PLAN | `build_revert.py` (F) |
| `IA_REVERT_V2_COMMIT.json` | executes the plan as resumable steps V0-V4 | `build_revert.py` (F) |
| `IA_REVERT.json` | the classic IA_REVERT v5 = dev / prod v4 + the 250-component-row guard (ships in the cut whatever the switches) | `build_revert.py` (F) |
| `IAform.json`, `IAlistPage.json` | the form (from dev v32) and the list (from dev v20); every new or changed script is mirrored next to them (`iaV2_*.js`, `iaForm_*.js`, `iaList_*.js`) | `client/build_client.py` (D) |
| `IA_V2_HANDOFF.md` | the pre-project hand-off notes (history, not maintained) | - |

Build: `python3 scratchpad/iav2/build_ia.py [--write] [NAME ...]` builds every workflow in the publish order (or each package's
own builder); the client builds with `python3 scratchpad/iav2/client/build_client.py [--write]`. Every built workflow must pass
`python3 scratchpad/validate.py <file>`, every SQL node `scratchpad/iav2/lib/sqlcheck.py` on dev (read-only).

## Switches and go / no-go

| Switch | Where | OFF |
|---|---|---|
| `ASYNC_IA_ENABLED` + `IA_V2_ACTIONS { COMPLETE, COMPLETE_POST }` | Completed / Complete & Post buttons, form mounted, list kick | every click runs the classic handler, byte-identical |
| `ASYNC_IA_REVERT_ENABLED` | list Revert Completed, list kick, form mounted (revert jobs) | every IA takes the classic IA_REVERT |

The switches are constants in the scripts, rebuilt, never hand-edited: `python3 build_client.py --write` builds OFF (the first
publish); `--on[=COMPLETE,COMPLETE_POST,REVERT] --write` builds ON and refuses while `ids.json` holds "0" for a workflow.
Rollback without a rebuild: bind `button_completed` back to `onClick_saveAsCompleted` (key `iasvcomp`) and `comp_post_button`
to `onClick_saveAsCompletedPost` (`aymq6q8z`).

**Go / no-go (CONTRACT ruling 9): COMPLETE and COMPLETE_POST may be ON only when REVERT is ON too.** The classic IA_REVERT v5
refuses an IA with more than 250 component rows whatever the switches, so an IA completed in the background above that size could
then be reverted only by Revert V2; with Revert V2 OFF it could not be reverted at all (the integration run `e2e.js` scenario 3c
shows it: 251 picks, v5 refuses, Revert V2 takes it back). `build_client.py` refuses such an ON build, and a click falls back to
the classic when the revert switch is OFF (fix wave R9). Per action (plan Task I): switch it ON only when its tests are green,
otherwise publish the form / list with that switch OFF, and state plainly what is not verified.

**Timing at size (dev 711077, 2026-10-19; CONTRACT ruling 11).** The time follows distinct materials, not lines: ~0.29 s per
distinct pick in op 1 (about 70 % of it the engine's lock-token TAKE / GIVE and lock-row release), ~0.05 s per Item stamp in I4.
The 830-component BOM: SUBMIT 6 s, then one tick of 285 s (COMMIT A 238 s, B 43 s); its Revert V2: one tick of 217 s. The form
follows a job for 420 s; a longer job ends with "post it from the list". The COMMIT lease is 30 minutes (a takeover during a
live engine run would duplicate movements). These are 10-19 dev numbers: per-row writes there cost ~7x what they did on 10-16
(lock-token atomic-count median 35 ms vs 5 ms; reads unchanged), so they are likely pessimistic.

Whatever the switches, the cut ships the guarded classics: IA_SAVE v12 (refuses a Processing IA, a stale-tab Draft save of a
Completed IA, a completion of more than 250 picks; non-stock lines need no picks) and IA_REVERT v5 (more than 250 component
rows -> 400, nothing written). Publish order: form + list (switches OFF; the form creates `ia_v2_job_id` / `ia_idem_key`, so it lands
before any SUBMIT) -> IA_SAVE v12 + IA_REVERT v5 -> IA_V2_PREPARE -> IA_V2_COMMIT -> IA_V2_WORKER -> IA_V2_SUBMIT ->
IA_REVERT_V2_PREPARE -> IA_REVERT_V2_COMMIT -> IA_REVERT_V2_WORKER -> IA_REVERT_V2_SUBMIT -> form + list with the switches ON.

## The completion (COMPLETE_IA)

1. The form's Save as Completed / Complete & Post with more than 50 stock picks (switches `ASYNC_IA_ENABLED`, `IA_V2_ACTIONS`)
   calls IA_V2_SUBMIT. SUBMIT writes the IA as `Processing` (with `ia_v2_job_id`), takes the document lock
   `gd_publish_step IAC|<iaId> / LOCK|<n>` and queues a `gd_async_job` (command `COMPLETE_IA`, correlation `IA|<iaId>`).
2. The form kicks IA_V2_WORKER every 15 s while it waits; the list's mounted script kicks it every 2 minutes. No Quartz.
3. One worker tick: claim (`W0_CLAIM_<row_version>`) -> PREPARE (VALIDATING -> READY_TO_COMMIT) -> COMMIT phase A ->
   COMMIT phase B. Above 1,000 picks COMMIT PARKs after phase A and the next tick runs phase B.

### IA_V2_COMMIT steps (each records `<STEP> DONE`; a rerun skips what is done)

| Step | Phase | Does | Failure |
|---|---|---|---|
| entry | - | reads the job, its I step rows, the I1 intent, the manifest, the IA's lock and op 1's engine rows in ONE fork-join; claims the lease `PUB|<nonce>` | phase A: bad manifest / IA not owned -> FAILED (+ Draft when owned), but REQUIRES_REVIEW once op 1 has engine rows (any phase-A failure; ruling 10 R2); phase B: IA not Processing / Completed under this job -> REQUIRES_REVIEW |
| I0_REVALIDATE | A | stored header Processing under this job, the plan's IA number, `iaLineFingerprint` = the plan's | FAILED `IA_NOT_LOCKED` / `IA_LINES_CHANGED` + Draft |
| I1_BATCH | A | batch parents only: a live Batch row of the parent with the number that is not ours -> FAILED `IA_BATCH_DUPLICATE`; else the intent `I1|I|001`, ONE Batch row (ADD_INVENTORY's columns), read back, then the receipt's re-PLAN with that batch_id | FAILED + Draft + our Batch row soft-deleted |
| I2_ISSUE | A | op 1 = APPLY `IAC|<jobId>|I` (one SUBTRACT per stock pick); then the hand-over SPLIT (<= 1,000 picks) or PARK, progress 75, attempt_count 0 | 400 -> FAILED (worded with the line / item / bin); 409 / no answer -> lock waits 15 s x 2^n (8), then FAILED `IA_INVENTORY_LOCK_BUSY`; with engine intent rows -> retry, then review; 500 -> REQUIRES_REVIEW |
| I3_RECEIPT | B | op 1 must be DONE, not under review, its stored OUT rows = its code-200 results; price = q8(sum of the stored OUT `total_price` / receipt base qty + `assembly_cost`); op 2 = APPLY `IAC|<jobId>|R` (R1 with that price and I1's batch_id; the same request on every retry); progress 80 | 409 / no answer -> 10 s waits (not counted) up to 30 min after I3's first transient answer, then REQUIRES_REVIEW `IA_RECEIPT_TIMEOUT`; R1 not "200" / 400 / 500 -> REQUIRES_REVIEW `IA_RECEIPT_REFUSED`; count off -> `IA_RECEIPT_COUNT_MISMATCH` |
| I4_FINISH | B | Item `last_transaction_date` (parent + every component, slices of 250, one ISO stamp), then the header `Completed` / `posted_status Unposted` (the unlock) | retries, then REQUIRES_REVIEW |
| finish | B | job COMPLETED, progress 100 | |

Phase A never moves stock before I2, so its failures are clean (once op 1 has an engine row, ruling 10 R2 makes any phase-A
failure a REQUIRES_REVIEW instead): FAILED, the IA back to Draft (only while the job owns it and
`prevStatus` is Draft; never a default), this job's own Batch row soft-deleted. The unlock is written first: once the IA
is Draft a resumed run fails at the entry and never calls the engine again. Phase B never unlocks and never fails: it retries
and then goes to REQUIRES_REVIEW with the IA left Processing.

Progress the form reads: QUEUED 0, VALIDATING 10, READY_TO_COMMIT 60, phase A 70, components issued 75, assembled item
received 80 (both operations moved stock), finishing 85, COMPLETED 100, FAILED / REQUIRES_REVIEW 0.

### Deliberate differences from the classic save

- One engine operation per leg instead of one child call per pick; both legs resumable, replayed on a rerun.
- The receipt is priced per BASE unit of the assembled item (the engine's rule): identical to the classic whenever `item_uom`
  is the base UOM (every prod IA so far); right where they differ.
- The price sums only THIS completion's issue rows (op 1's operation key), never an earlier cycle of a re-completed IA.
- No blank Batch row for a non-batch parent (the classic mints one; IA_REVERT copes).
- Non-stock (labour / overhead, stock_control 0) lines move nothing and add nothing to the cost (the user's decision; same as
  the classic v12). A pick whose item became non-stock after PREPARE is skipped by op 1 ("401") and priced out, as the classic.
- Manual Input batch parents, HU picks, serial items and other categories stay on the classic save this cut (SUBMIT answers
  NOT_ELIGIBLE; COMMIT refuses a manifest whose batchMode is not `insert` / `none`).

## Revert V2 (REVERT_IA)

The list's "Revert Completed" sends big IAs (more than 50 live stock rows) to the background. ONE engine operation takes the
stock back, then the assembled item's own costing rows are restored under its COST lock, the Batch rows the assembly minted
are removed and the header goes back to Draft (number kept). "Live rows" = the classic's own pairing of the IA's movement rows
(`liveOut` + `liveIn` of `code_node_iaRvPrep`): one reverse movement each. IA_REVERT_V2_SUBMIT answers, in this order:

| Case | Answer |
|---|---|
| the stored IA missing | STOP 400 `IA_RV_NOT_FOUND` |
| Processing, an open COMPLETE_IA or REVERT_IA job of the IA, or a young lock of another click | BUSY 409 (`IA_RV_BUSY`; `IA_RV_UNDER_REVIEW` when that job is under review) |
| the list row's status is not the stored one | STALE 409 `IA_RV_STALE` |
| the classic would refuse it (not Completed, posted to accounting) | STOP 400 `IA_RV_REFUSED` with the classic's own text |
| live rows <= 50 (`min_picks`) | NOT_ELIGIBLE `classic`: the list calls the classic IA_REVERT, nothing written |
| a live row on a handling unit, or a serial-numbered item | NOT_ELIGIBLE up to 250 component rows (classic), STOP 400 `IA_RV_TOO_BIG` above |
| more than 5,000 live rows | STOP 400 `IA_RV_SPLIT_REQUIRED` |
| otherwise | QUEUED: `LOCK|n+1` on `IAC|<iaId>`, the job (QUEUED, due in 2 min), the header Processing + `ia_v2_job_id`, read back, due now |

A revert and a completion share the correlation `IA|<iaId>`, the lock rows `IAC|<iaId>` and the Processing state, so they
never overlap. `operation STATUS` reports the key's job, else the IA's latest job of either command. After a V2 revert the IA
is Draft with its number; completing it again issues a new number (a COMPLETED job ran under the old one).

1. PREPARE (VALIDATING): the job must still own the IA (Processing, its `ia_v2_job_id`, the latest lock = its key) and the
   IA's movement rows must be the ones SUBMIT saw (`IM1:` fingerprint). The lifted classic code runs on them with the status
   seen as Completed. Its conflicts (the assembled item used, its stock moved on) end the job FAILED with the classic's list
   (`IA_RV_CONFLICTS`, details in `error_details`) and the IA back to Completed. Else the parts are written and the engine
   PLANs the reverse movements; any refusal -> FAILED + Completed, nothing moved. READY_TO_COMMIT, progress 60.
2. COMMIT phase A (progress 70) and, in the same tick, phase B (85); above 1,000 movements phase A PARKs and the next tick
   runs phase B. COMPLETED, progress 100: the IA reads Draft with its number.

| Step | Phase | Does | Failure |
|---|---|---|---|
| entry | - | job, its V step rows, the manifest and the IA's lock in one fork-join; lease `PUB|<nonce>` | phase A: bad manifest / IA not owned -> FAILED (+ Completed when owned); phase B: the IA not Processing / Draft under this job -> REQUIRES_REVIEW |
| V0_REVALIDATE | A | the IA Processing under this job, its movement rows' `IM1:` = the plan's | FAILED `IA_RV_NOT_LOCKED` / `IA_RV_ROWS_CHANGED` + Completed |
| V1_INVENTORY | A | APPLY `IAV|<jobId>`: movements M1..Mn = the classic's SUBTRACT then ADD calls in its order (the assembled item out with `isMovingInv 1`, the components back at the cost they left at); SPLIT / PARK, progress 80 | 400 with a result_code -> FAILED `IA_RV_INVENTORY_<code>` + Completed (the message names item / bin); 409 / no answer -> 15 s x 2^n waits (8), then FAILED `IA_RV_INVENTORY_LOCK_BUSY`; with engine intent rows -> retry, then review; 500 -> REQUIRES_REVIEW |
| V2_COST | B | only after V1 DONE: `COST|<assembled item>|<plant>` taken as `IAV|<jobId>|C` (seed, claim, TAKE, verify); each FIFO / WA row of the COST part read fresh: at its after-value -> done, at its before-value (as PREPARE read it) -> the classic's write (FIFO / WA batch rows removed, the running WA restated); read back; the lock given back on every exit and after DONE, then checked | lock busy -> 5 s waits, not counted, until 30 min after V2's first busy wait -> REQUIRES_REVIEW `IA_RV_COST_TIMEOUT`; a row at neither value -> REQUIRES_REVIEW `IA_RV_COST_CHANGED` |
| V3_BATCH | B | the Batch rows the assembly minted soft-deleted (slices of 250), read back (skipped when there are none: V2 mints none for a non-batch parent) | retries, then REQUIRES_REVIEW |
| V4_FINISH | B | the header `item_assembly_status` Draft, `posted_status` '' (the unlock; the number is kept) | not Processing / Draft under this job -> REQUIRES_REVIEW |
| finish | B | job COMPLETED, progress 100 | |

Phase A never moves stock before V1, so its failures are clean (once `IAV|<job>` has an engine row, ruling 10 R2 makes any
phase-A failure a REQUIRES_REVIEW instead): FAILED and the IA back to Completed (only while the job owns
it and `prevStatus` is Completed; never a default). Phase B never unlocks and never fails: it retries, then REQUIRES_REVIEW
with the IA left Processing. Progress: QUEUED 0, VALIDATING 10, READY_TO_COMMIT 60, phase A 70, stock taken back 80, phase B
85, COMPLETED 100, FAILED / REQUIRES_REVIEW 0.

### Deliberate differences from the classic IA_REVERT

- Stock all or nothing in one engine operation, replayed on a rerun; the classic makes one child call per movement and can
  stop half-way. The `IA-R` movement rows are the classic's, plus `operation_effect_key` `IAV|<jobId>|M<n>`.
- The assembled item's FIFO / WA rows are written under its COST lock, and only from the values PREPARE planned from; the
  classic takes no lock.
- The IA's movement rows are fingerprinted at SUBMIT and checked in PREPARE and V0; no fetch caps (the classic's 1,000-row
  ceilings are lifted as GR Revert V2 does).
- The IA reads Processing while the job runs: IA_SAVE, both SUBMITs and the classic IA_REVERT refuse it.
- Handling-unit and serial IAs stay classic (up to 250 component rows).

### The classic IA_REVERT v5

v4 (identical on dev and prod) plus two top-level nodes after `code_node_iaRvPrep`: more than 250 component rows (prep's
`liveOut`; the message counts all stock rows) on an IA the classic would not refuse -> `{ code "400", message "This Item Assembly has <n> stock rows; this revert can process at most
250 at once. Revert it from the Item Assembly list if background revert is switched on, or contact support.", conflicts [] }`,
nothing written. A refused IA keeps the classic's refusal (not Completed, so also Processing; posted to accounting). Every
other node byte-identical (`test/revert/diff_v4.py`).

## The client (form and list)

- Completed / Complete & Post: V2 (IA_V2_SUBMIT) when the switch and action are on, the page is Add / Clone or an Edit of a
  stored Draft, more than 50 picks (`temp_qty_data` entries with `sm_quantity > 0`), no handling unit, no serial number;
  anything else -> the classic handler (once). The classic's `this.validate()` and BOM-variance confirm run first.
- Complete & Post posts with the classic `postToAccounting` code, verbatim, only once the job is COMPLETED; if the 420 s wait
  ends first: "Still completing in the background; post it from the list once it shows Completed." With `COMPLETE_POST` off
  (and `COMPLETE` on) a big Complete & Post completes in the background and is posted from the list.
- A Processing IA opens read-only (badge, no save / post button, components locked); with a switch on it follows the job
  (STATUS, worker kick every 15 s: the completion or the revert worker by the job's action). A failed job is shown once per
  browser (`localStorage ia_v2_failed_seen_<jobId>`).
- List: the first `mounted` kicks IA_V2_WORKER and IA_REVERT_V2_WORKER (each on its switch, at most every 2 minutes per
  browser); Edit is hidden and Delete refused for a Processing IA (Delete re-reads the stored status first); Revert Completed
  sends each IA to IA_REVERT_V2_SUBMIT (`min_picks` 50): 50 live rows or fewer, NOT_ELIGIBLE, INVALID or no usable answer
  -> the classic IA_REVERT call for that IA, unchanged.
- Labour / overhead (whatever the switches): a non-stock (`stock_control` 0) component carries `total_quantity` = its BOM
  quantity (or the typed one), no picks, no auto-allocation, no Transfer Stock (the link is disabled; opening the dialog on
  one closes it with a message). Every explode / allocate read has an explicit `.limit()`, 500-id chunks and a re-read when
  the API clamps it (5,000 rows).

Limits:
- **Posting:** the posting fetch (SQL_FETCH_POST_DATA, dev v220) refuses more than 1,000 distinct item ids, the parent
  included ("Too many reference IDs; split task"): an IA above ~1,000 components cannot be posted (830 is fine). It also
  needs `total_quantity > 0` on every line (non-stock lines carry their quantity).
- Mobile still uses the classic save; its client-side delete must refuse Processing.

## Error codes

Completion (COMMIT and WORKER):

| Code | Job | Meaning |
|---|---|---|
| IA_NOT_LOCKED, IA_LINES_CHANGED, IA_INVALID_DATA | FAILED | the IA changed / is no longer this job's / the plan is unusable: nothing was moved |
| IA_BATCH_DUPLICATE | FAILED | the generated batch number is already used ("Duplicate Batch Format found.") |
| IA_BATCH_FAILED | FAILED | the Batch row did not read back after its insert (3 retries) or was inserted twice |
| IA_PLAN_SKIPPED, IA_INVENTORY_<code>, IA_PLAN_FAILED | FAILED | the receipt's re-PLAN (I1) or op 1 (I2) refused; the message names the line / item / bin |
| IA_INVENTORY_LOCK_BUSY | FAILED | the components stayed locked by another operation for 8 waits |
| IA_TRANSIENT_RETRIES_EXHAUSTED | FAILED | the worker: a callee kept answering without a code / runs died before COMMIT |
| IA_RECEIPT_COUNT_MISMATCH, IA_RECEIPT_REFUSED, IA_RECEIPT_TIMEOUT | REQUIRES_REVIEW | op 2 could not be applied (I3) |
| IA_RECONCILIATION_MISMATCH | REQUIRES_REVIEW | a step after op 1 did not complete, op 1 answered 500, a COMMIT run died 3 times, or a phase-A failure after op 1 wrote (ruling 10 R2) |
| IA_PREV_STATUS_UNKNOWN | REQUIRES_REVIEW | the status to restore is not Draft: nothing unlocked |
| IA_LOCK_WAIT, IA_WAIT, IA_STEP_RETRY, IA_TRANSIENT | open job | waiting / retrying (progress message only) |

Revert V2 (the texts are the revert's own: "no longer locked by this revert", "the revert stopped half-way", "not reverted."):

| Code | Where | Job / answer | Meaning |
|---|---|---|---|
| IA_RV_INVALID_REQUEST, IA_RV_INVALID_DATA | SUBMIT / any | INVALID 400 / FAILED | a bad request / an unusable plan, nothing moved |
| IA_RV_NOT_FOUND, IA_RV_REFUSED | SUBMIT, PREPARE | STOP 400 / FAILED | the classic's refusals |
| IA_RV_BUSY, IA_RV_UNDER_REVIEW, IA_RV_STALE | SUBMIT | 409 | another job / click holds the IA, or the list row is stale |
| IA_RV_NOT_ELIGIBLE, IA_RV_TOO_BIG, IA_RV_SPLIT_REQUIRED | SUBMIT, PREPARE | 300 / STOP 400 / FAILED | handled by the classic, or too big for either |
| IA_RV_QUEUE_FAILED | SUBMIT | STOP 500 | the queue rows did not read back |
| IA_RV_NOT_LOCKED, IA_RV_ROWS_CHANGED | PREPARE, V0 | FAILED | the IA is no longer this job's / its movement rows changed: nothing moved |
| IA_RV_CONFLICTS | PREPARE | FAILED | the classic's conflict list (in `error_details`) |
| IA_RV_PLAN_SKIPPED, IA_RV_PLAN_FAILED, IA_RV_PLAN_BROKEN, IA_RV_INVENTORY_<code> | PREPARE PLAN, V1 | FAILED | the engine refused: nothing moved |
| IA_RV_INVENTORY_LOCK_BUSY | V1 | FAILED | the stock stayed locked by another operation for 8 waits |
| IA_RV_TRANSIENT_RETRIES_EXHAUSTED | WORKER | FAILED | a callee kept answering without a code / runs died before COMMIT |
| IA_RV_COST_CHANGED, IA_RV_COST_TIMEOUT | V2 | REQUIRES_REVIEW | the assembled item's costing moved after PREPARE / its COST lock stayed busy 30 min |
| IA_RV_RECONCILIATION_MISMATCH | COMMIT | REQUIRES_REVIEW | a step after V1 did not complete, V1 answered 500, a COMMIT run died 3 times, or a phase-A failure after the engine operation wrote |
| IA_RV_PREV_STATUS_UNKNOWN | any unlock | REQUIRES_REVIEW | the status to restore is not Completed: nothing unlocked |
| IA_RV_LOCK_WAIT, IA_RV_WAIT, IA_RV_STEP_RETRY, IA_RV_TRANSIENT | COMMIT / WORKER | open job | waiting / retrying (progress message only) |

## REQUIRES_REVIEW runbook: completion (CONTRACT section 9)

A job in REQUIRES_REVIEW leaves the IA `Processing` (the classic save, SUBMIT and the list refuse it) and the engine keeps the
locks of an operation under review (they block GD / GR / SA / Putaway V2 on those items) until someone resolves it. Dev: the
user runs every write with `.dbtools/dbw`, one yes each. Prod is SELECT-only: the same changes go through the platform by the
user / support, never by a session.

1. Read the job and both operations' rows (`<t>` tenant, `<job>` job id, `<ia>` IA id):
   ```sql
   SELECT CAST(id AS CHAR) AS id, job_status, error_code, error_message, error_details, progress_percent, attempt_count, lease_owner, next_attempt_at
     FROM gd_async_job WHERE tenant_id = '<t>' AND id = <job>;
   SELECT CAST(id AS CHAR) AS id, job_id, step_name, step_status, LEFT(result_ref, 300) AS ref, error_message, finished_at
     FROM gd_publish_step
    WHERE tenant_id = '<t>' AND job_id IN ('<job>', 'IAC|<job>|I', 'IAC|<job>|R', 'IAC|<ia>') AND is_deleted = 0 ORDER BY id;
   SELECT lock_key, owner_operation_id, claimed_at FROM inventory_balance_lock
    WHERE tenant_id = '<t>' AND owner_operation_id IN ('IAC|<job>|I', 'IAC|<job>|R');
   ```
   `error_details.step` names the step; the job's own rows are `I0_` .. `I4_` and the intent `I1|I|001`; each operation has
   `IBA|I|nnn` (intents), `IBA|DONE` (`{results, summary}`) or `IBA|REVIEW`.
2. **Op 1 under review** (`IAC|<job>|I` has `IBA|REVIEW`; I2 not DONE): fix the cause, soft-delete that `IBA|REVIEW` row,
   reset the job (below), kick the worker: COMMIT resumes at I2 (the engine resumes from its own intent) - op 2 can never
   start first (I3 refuses while op 1 is under review or not DONE).
3. **Op 1 DONE, I3 stopped** (`IA_RECEIPT_*`, or op 2's `IBA|REVIEW`): check op 1's stored OUT rows against its DONE summary
   (`SELECT COUNT(*), SUM(total_price) FROM inventory_movement WHERE tenant_id = '<t>' AND id > <job> AND is_deleted = 0 AND
   movement = 'OUT' AND transaction_type = 'IA' AND operation_effect_key LIKE 'IAC|<job>|I|%'`), fix the cause (R1 "401": the
   assembled item's stock_control; a 400: the receipt bin's balance rows; a timeout: the operation holding the receipt's lock
   keys), soft-delete op 2's `IBA|REVIEW` if any, reset the job, kick: COMMIT resumes at I3 with the same price and the same
   request. `IA_RECEIPT_TIMEOUT` counts 30 minutes from I3's FIRST transient answer (`error_details.waitFrom`, ruling 10 R4),
   not from I2: the reset below clears it, so the resumed I3 gets a fresh 30-minute window (clear the blocker first anyway).
4. **Op 1 moved stock but the IA is no longer Processing / Completed under the job** (e.g. deleted by an old mobile client):
   after I2 the entry reviews it; before I2 DONE (a run died right after op 1's APPLY, then the IA lost its lock) the failure
   COMMIT would have written is in `error_details.wouldFail` with `step` `I2_ISSUE` (ruling 10 R2: never "nothing moved" once
   `IAC|<job>|I` has an `IBA|I|` / `IBA|DONE` row). The components were issued (check op 1's `IBA|DONE` and OUT rows) and the
   receipt was not; decide with the business whether to restore the IA (`is_deleted = 0`, Processing under the job) and reset
   the job (COMMIT resumes at I2, op 1 answers REPLAYED, then I3), or to put the stock back by hand. The classic IA_REVERT
   cannot (the IA is not Completed).
5. **IA_PREV_STATUS_UNKNOWN** (phase A, nothing moved): correct the request's `prevStatus` to `Draft` and reset, or end it:
   job FAILED, the IA `Draft`, and the job's Batch row (the `I1|I|001` identity, `id > <job>`) soft-deleted.
6. Reset (dev):
   ```sql
   UPDATE gd_async_job SET job_status = 'COMMITTING_IA', attempt_count = 0, lease_owner = NULL, lease_expires_at = NULL,
          next_attempt_at = NOW(3), error_code = NULL, error_message = NULL, error_details = NULL, finished_at = NULL
    WHERE tenant_id = '<t>' AND id = <job>;
   ```
   then IA_V2_WORKER `{ "job_id": "<job>" }` (clearing `error_details` also restarts I3's wait window). Never soft-delete one
   of the job's own `I*` rows to redo a step: the unique `Job Step` index (tenant, job_id, step_name) includes deleted rows,
   so the re-insert would fail the run.

## REQUIRES_REVIEW runbook: Revert V2 (CONTRACT RV7)

A revert job in REQUIRES_REVIEW leaves the IA `Processing` (IA_SAVE, both SUBMITs and the classic IA_REVERT refuse it). An
engine operation under review keeps its locks, and a `COST|<item>|<plant>` row still held by `IAV|<jobId>|C` blocks every
V2 posting of the assembled item at that plant, until someone resolves it. Dev: the user runs every write with
`.dbtools/dbw`, one yes each. Prod is SELECT-only: the same changes go through the platform by the user / support, never by a
session.

1. Read the job, its rows and the locks (`<t>` tenant, `<job>` job id, `<ia>` IA id, `<org>` organization):
   ```sql
   SELECT CAST(id AS CHAR) AS id, job_status, error_code, error_message, error_details, progress_percent, attempt_count, lease_owner, next_attempt_at
     FROM gd_async_job WHERE tenant_id = '<t>' AND id = <job>;
   SELECT CAST(id AS CHAR) AS id, job_id, step_name, step_status, LEFT(result_ref, 300) AS ref, error_message, finished_at
     FROM gd_publish_step
    WHERE tenant_id = '<t>' AND job_id IN ('<job>', 'IAV|<job>', 'IAC|<ia>') AND is_deleted = 0 ORDER BY id;
   SELECT CAST(id AS CHAR) AS id, lock_key, free_token, owner_operation_id, last_owner_operation_id, lock_version
     FROM inventory_balance_lock
    WHERE tenant_id = '<t>' AND organization_id = '<org>' AND is_deleted = 0
      AND (owner_operation_id IN ('IAV|<job>', 'IAV|<job>|C') OR (free_token = 0 AND last_owner_operation_id = 'IAV|<job>|C'));
   ```
   `error_details.step` names the step. The job's own rows are `V0_` .. `V4_` and the parts `P|<nonce>|<PART>|nnn`; the
   engine operation `IAV|<job>` has `IBA|I|nnn` (intents), `IBA|DONE` (`{results, summary}`) or `IBA|REVIEW`.
2. **V1 under review** (`IAV|<job>` has `IBA|REVIEW`, V1 not DONE, or V1 answered 500): fix the cause, soft-delete that
   `IBA|REVIEW` row, reset the job (6), kick the worker: COMMIT resumes at V1 (the engine resumes from its own intents);
   V2 never starts before V1 is DONE.
   **A phase-A failure after the engine wrote** (`IA_RV_RECONCILIATION_MISMATCH`, `error_details.step` V1_INVENTORY, "has
   already written"): the IA lost its lock (e.g. deleted) or the plan broke after `IAV|<job>` wrote intent / DONE rows, so
   the stock may already be back; nothing was unlocked. Restore the IA's row (`is_deleted 0`, Processing, its
   `ia_v2_job_id`) and reset: V1 replays the operation and phase B finishes. Or decide with the business to put the stock
   back by hand and end the job.
3. **V1 DONE, V2 stopped** (the stock is already back; the costing rows are not):
   - `IA_RV_COST_TIMEOUT`: `owner_operation_id` of the `COST|<assembled item>|<plant>` row names the operation holding it;
     resolve that one first. The deadline counts 30 min from V2's first busy wait (kept in the job's
     `error_details.waitFrom` while V2 waits); the reset (6) clears it, so a reset job waits a fresh 30 minutes.
   - `IA_RV_COST_CHANGED`: `error_details.why` names the rows. The COST part (`P|<nonce>|COST|001`) holds each row's
     `before` (as PREPARE read it) and `after` (the classic's value). Decide with the business, then bring each named row to
     its `before` (V2 writes it) or its `after` (V2 counts it done).
   Then reset the job: COMMIT resumes at V2 with the same COST part, takes the lock again and gives it back.
4. **V3 / V4 stopped**, or after V1 the IA is no longer Processing / Draft under the job (e.g. deleted): the stock is back
   (V1 DONE); the costing rows, the Batch rows or the header may not be. Fix the cause (restore the IA's row if it was deleted) and reset: COMMIT resumes at the first
   step not DONE. To end it instead, write the header `Draft` / `posted_status ''` by hand and set the job FAILED.
5. **IA_RV_PREV_STATUS_UNKNOWN** (nothing moved): correct the request's `prevStatus` to `Completed` and reset, or end it:
   job FAILED, the IA `Completed`.
6. Reset (dev):
   ```sql
   UPDATE gd_async_job SET job_status = 'COMMITTING_REVERT', attempt_count = 0, lease_owner = NULL, lease_expires_at = NULL,
          next_attempt_at = NOW(3), error_code = NULL, error_message = NULL, error_details = NULL, finished_at = NULL
    WHERE tenant_id = '<t>' AND id = <job>;
   ```
   then IA_REVERT_V2_WORKER `{ "job_id": "<job>" }`. Never soft-delete one of the job's own `V*` rows to redo a step: the
   unique `Job Step` index (tenant, job_id, step_name) includes deleted rows, so the re-insert would fail the run.
7. **COST lock rows**: a COMMIT run that died while holding them leaves `free_token 0` with owner `IAV|<job>|C` (or owner ''
   and last owner `IAV|<job>|C`); the job's next COMMIT run gives them back itself. Only when the job is ended by hand and
   such a row remains: give it back the way V2 does - owner '' with last owner `IAV|<job>|C`, then INVENTORY_LOCK_TOKENS
   `{ mode: "GIVE", operation_id: "IAV|<job>|C", ids: [<row id>], claimed_at: "" }`.

## Tests

| Package | Command | What |
|---|---|---|
| A PREPARE | `node scratchpad/iav2/test/prepare/test_prepare.js` | the built PREPARE on the interpreter: 5 recorded classic runs (prod goldens outside the repo), the classic v11 as the oracle, the real engine's PLAN, 25 failure paths, sizes |
| B SUBMIT + v12 | `sh scratchpad/iav2/test/submit/run_b.sh [--no-db]` | rebuilds both; v12 = v11 node by node (`classic/diff_v11.py`); v12 / guard sims; SUBMIT units and sim; the SQL on dev (read-only) |
| C COMMIT + WORKER | `sh scratchpad/iav2/test/commit/run_all.sh [--sql]` | `test_steps.js` (every step decision loaded from the built nodes, the write nodes, the declared output types), `commit_sim.js` (the built COMMIT on the interpreter with the deployed engine planner: happy paths incl. a Blocked receipt and the same balance on two lines, a crash after every write then the resume, every failure and review path, PARK, node data at 830 / 2,000 picks), `worker_sim.js`, `e2e_sim.js` (the built WORKER driving the built COMMIT), `sql_values.json` (sqlcheck on dev, read-only) |
| D client | `node scratchpad/iav2/client/check_all.js` | OFF = base call for call; routing, the V2 path, Complete & Post, mounted, labour / reads (830 lines, clamps), the lists, JSON integrity, the shipped ON build; 17 mutants |
| E live kit | `python3 scratchpad/iav2/live/test_kit.py` | the payload builder, twins, snapshot / diff / recon tools (read-only); the live checks themselves are `live/RUNBOOK.md` |
| F Revert V2 + v5 | `sh scratchpad/iav2/test/revert/run_all.sh [--db]` | the lifted bodies against 10 recorded classic runs (5 prod, 5 dev; prod fixtures outside the repo in `~/Documents/ASC-dev/iav2-fixtures/f/`, re-pulled read-only by `fetch_runs.py`), the plan's movements against the 27 recorded SUBTRACT / ADD child calls field for field, PREPARE / SUBMIT / COMMIT units incl. the COST-lock owner in all four places, the built COMMIT on the interpreter with the engine's own core (a crash after every write then the resume, V1 refusals and waits, the COST lock busy then free / past its deadline, WA / batch / Blocked parents, PARK; node data 14.5 MB PREPARE / 7.2 MB COMMIT A at 5,000 movements with `commit_sim.js --5000`), the worker end to end, the classic v5 against v4 (same writes at <= 250 rows, nothing at 251) and classic-vs-V2 twins, `diff_v4.py`, sqlcheck on dev, `sql_live.py` (the movement read = the recorded classic reads on dev and prod) |
| shared | `node scratchpad/iav2/test/shared/test_shared.js`, `python3 scratchpad/iav2/test/lib_smoke.py` | `code/shared` (texts, fingerprint, price, keys) and the copied tooling |
| integration | `python3 scratchpad/iav2/test/integration/interfaces.py`, `node scratchpad/iav2/test/integration/e2e.js`, `node scratchpad/iav2/test/integration/mutants.js` | the cross-package interfaces with file:line citations; every built workflow built with stand-in shell ids in memory and run end to end on one world: completions (non-batch Add, stored Draft batch parent, short stock twice) -> Revert V2 of the IA C's COMMIT completed -> completed again under a new number; the classic v5 on V2 completions; 8 interface mutants caught |
