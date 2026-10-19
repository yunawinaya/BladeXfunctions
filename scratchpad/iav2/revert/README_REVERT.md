# Revert V2 (REVERT_IA): background revert of a Completed Item Assembly

The Item Assembly list's "Revert Completed" sends big IAs (more than 50 live stock rows) to the background, on the shared
engine INVENTORY_BULK_APPLY. ONE engine operation takes the stock back, then the assembled item's own costing rows are
restored under its COST lock, the Batch rows the assembly minted are removed and the header goes back to Draft (number
kept). The classic IA_REVERT keeps small IAs, handling-unit / serial IAs up to 250 component rows and mobile, and from v5 on
refuses an IA with more than 250 component rows: the picks the classic completion also caps at 250 (the receipt row is not
counted, so an IA completed with 250 picks stays revertible). Binding interface: `scratchpad/iav2/CONTRACT.md` part "Revert V2" (RV1-RV10).

Status (2026-10-19): built and tested in the builder folder; NOTHING published. Shell ids are `"0"` in
`scratchpad/iav2/ids.json` until the user creates the dev designer shells; rebuild with the real ids before any publish.

## Files

| File | What |
|---|---|
| `IA_REVERT_V2_SUBMIT.json` | synchronous entry the list calls (SUBMIT / STATUS): the classic's refusals on the stored IA (its own prep, lifted), size and eligibility routing, then the lock, the job and the header Processing |
| `IA_REVERT_V2_WORKER.json` | the tick: claims due REVERT_IA jobs (at most 5 per tick, 20 s budget), runs PREPARE, then COMMIT phase A and phase B |
| `IA_REVERT_V2_PREPARE.json` | planner: the classic's reads without row caps, its `code_node_iaRvParams` / `_iaRvPrep` / `_iaRvBuild` lifted verbatim, the parts ENGINE / COST / BATCH / HDR / LABELS, the engine PLAN |
| `IA_REVERT_V2_COMMIT.json` | executes the plan as resumable steps V0-V4 |
| `IA_REVERT.json` | the classic IA_REVERT v5 = dev / prod v4 + the 250-component-row guard (ships in the cut whatever the switches) |

Build: `python3 scratchpad/iav2/build_revert.py [--write] [NAME ...]` (or `build_ia.py`). Checks:
`sh scratchpad/iav2/test/revert/run_all.sh [--db]` (`--db` adds the read-only database checks).
Publish order: the form (it creates `ia_v2_job_id`) -> IA_REVERT v5 (batch 1, with IA_SAVE v12) -> IA_REVERT_V2_PREPARE ->
IA_REVERT_V2_COMMIT -> IA_REVERT_V2_WORKER -> IA_REVERT_V2_SUBMIT -> the list with `ASYNC_IA_REVERT_ENABLED`.

## What goes to the background

"Live rows" = the classic's own pairing of the IA's movement rows (`liveOut` + `liveIn` of `code_node_iaRvPrep`): one
reverse movement each. SUBMIT answers, in this order:

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
never overlap. `operation STATUS` reports the key's job, else the IA's latest job of either command.

## How a revert runs

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
| V3_BATCH | B | the Batch rows the assembly minted soft-deleted (slices of 250), read back | retries, then REQUIRES_REVIEW |
| V4_FINISH | B | the header `item_assembly_status` Draft, `posted_status` '' (the unlock; the number is kept) | not Processing / Draft under this job -> REQUIRES_REVIEW |
| finish | B | job COMPLETED, progress 100 | |

Phase A never moves stock before V1, so its failures are clean: FAILED and the IA back to Completed (only while the job owns
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
`liveOut`; the message counts all stock rows) on an IA the classic would not refuse -> `{ code "400", message "This Item Assembly has <n> stock rows; this revert can process at most 250
at once. Revert it from the Item Assembly list if background revert is switched on, or contact support.", conflicts [] }`, nothing written. A refused IA keeps the classic's refusal
(not Completed, so also Processing; posted to accounting). Every other node byte-identical (`test/revert/diff_v4.py`).

## Error codes

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

## REQUIRES_REVIEW runbook (CONTRACT RV7)

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

## Tests (package F)

`scratchpad/iav2/test/revert/` (`run_all.sh`): the lifted bodies against 10 recorded classic runs (5 prod, 5 dev; prod
fixtures outside the repo in `~/Documents/ASC-dev/iav2-fixtures/f/`, re-pulled read-only by `fetch_runs.py`), the plan's
movements against the 27 recorded SUBTRACT / ADD child calls field for field, PREPARE / SUBMIT / COMMIT units incl. the
COST-lock owner in all four places, the built COMMIT on the interpreter with the engine's own core (a crash after every
write then the resume, V1 refusals and waits, the COST lock busy then free / past its deadline, WA / batch / Blocked parents,
PARK; node data 14.5 MB PREPARE / 7.2 MB COMMIT A at 5,000 movements with `commit_sim.js --5000`), the worker end to end,
the classic v5 against v4 (same writes up to 250 picks, nothing at 251) and classic-vs-V2 twins, `diff_v4.py`, sqlcheck on dev,
`sql_live.py` (the movement read = the recorded classic reads on dev and prod).
