# Stock Adjustment V2 (background completion for big adjustments)

A Stock Adjustment completed from the web form with **more than 50 stock entries** (balance entries with `sa_quantity > 0`) is
completed in the background, through the shared inventory engine (INVENTORY_BULK_APPLY), instead of the classic
`STOCK_ADJUSTMENT` workflow. The classic completion costs about 0.4 s per entry in one browser request, writes the header
`Completed` before any stock moves, and is not atomic (13 prod SAs are Completed with movements missing).

The same machinery completes a **Stock Count Review** of more than 50 approved variance lines: see `../../Stock Count/AsyncV2/README.md`.
Smaller documents, mobile, and anything not eligible keep the classic path, which now has a guard (see below).

Built and switched ON on dev 2026-10-16; ships ON in the full deployment of the week of 2026-10-19. Design and every interface:
`scratchpad/sav2/CONTRACT.md`. Builder, tests and the live test kit: `scratchpad/sav2/`.

## Workflows (dev ids; the same in prod after a full deployment)

| Workflow | id | Role |
|---|---|---|
| SA_V2_SUBMIT | 2111074320177860610 | Synchronous. Runs the classic's gates (same codes, same texts), then writes job + document + lock rows idempotently. Answers SUBMIT / STATUS. |
| SA_V2_WORKER | 2111074368689180673 | Claims due `COMPLETE_SA` jobs and runs PREPARE, then COMMIT phase A, then phase B. Above 1,000 entries the job PARKs after phase A and the next kick runs phase B. |
| SA_V2_PREPARE | 2111074403720007681 | SQL reads + the classic compute code lifted verbatim. Writes the manifest parts ENGINE / LABELS / SALINES / SC / HDR / ITEMS / REORDER. |
| SA_V2_COMMIT | 2111074444748689410 | A0 revalidate → A1 SA lines → A2 one engine APPLY (all-or-nothing) → A3 Stock Count → A4 item dates, reorder, header `Completed`. **Still named SA_V2_PREPARE in the designer** (created under that name; rename it to SA_V2_COMMIT). |
| STOCK_ADJUSTMENT | 2032025505853816833 | The classic save: deployed v24 plus guard nodes (`STOCK_ADJUSTMENT.json`). |
| INVENTORY_BULK_APPLY | 2109916822821744641 | The shared engine (`Balance Table/`), owned by the GD Completed session. |

Repo files: `SA_V2_*.json`, `STOCK_ADJUSTMENT.json` (guarded classic), `SAform.json` (dev form v315), `SAlistPage.json` (dev list
v59), the handler mirrors `saV2_onClick_completed.js`, `saV2_mounted_block.js`, `saV2_list_mounted_kick.js`, and `ids.json`.
Rebuild: `python3 scratchpad/sav2/build_sa.py --write` (workflows), `python3 scratchpad/sav2/client/build_client.py --on --write`
(form + list). **Without `--on` the client builds with the switches OFF.**

**The repo's `../SAsaveWorkflow.json`, `../SAfullJSON.json` and the older SA `.js` files are NOT the deployed versions.** Never deploy them.

## What goes to V2

The Completed and the Completed & Post buttons (Completed & Post completes only, as in the classic). V2 needs all of these;
anything else runs the classic handler, unchanged:
- `ASYNC_SA_ENABLED` is true and more than `SA_V2_MIN_ENTRIES` (50) entries have `sa_quantity > 0`;
- the stored status is Draft, or the SA is new (Add / Clone);
- no serialized line.

SUBMIT then answers NOT_ELIGIBLE (→ classic, up to 500 entries; above that it stops with the reason) for:
- handling-unit entries;
- categories other than Unrestricted / Blocked / Quality Inspection;
- items whose costing rows need migration;
- no default SA numbering rule.

It always stops (400, nothing written):
- more than 5,000 entries (`SA_SPLIT_REQUIRED`);
- any line whose `balance_index` is over 60,000 bytes (`SA_LINE_TOO_LARGE`);
- an Out of a Weighted Average item with no WA row at the plant (`SA_NO_WA_RECORD`).

| Action | From → to | Writes at SUBMIT |
|---|---|---|
| DIRECT | Add / Clone → Completed | job → the SA (Processing, an issued number) → lock |
| COMPLETE | Draft → Completed | lock → job → the edited document as a part → header Processing + number |
| REVIEW | Stock Count Review | review guard → job → a NEW SA header (Processing) → lock → the Stock Count as a part |

The stock moves in one engine call: either every entry moves or none does. The header turns `Completed` only after the stock moved.

## Switches (client constants; there is no server-side switch)

Each switch is a constant inside a page's event handler, and every copy must be set:

| Where | Handler | Constants |
|---|---|---|
| `SAform.json` | `saV2_onClick_completed` (Completed) | `ASYNC_SA_ENABLED`, `SA_V2_MIN_ENTRIES` |
| `SAform.json` | `saV2_onClick_completed_post` (Completed & Post) | `ASYNC_SA_ENABLED`, `SA_V2_MIN_ENTRIES` |
| `SAform.json` | `mounted` (the Processing view) | `SA_BG_ENABLED` |
| `SAlistPage.json` | `mounted` (worker kick) | `ASYNC_SA_ENABLED` |

- Off = the buttons call the classic `onClick_completed` / `onClick_completed_post` (rule handlers, byte-identical) through
  `triggerEvent`. Rollback without a rebuild: bind the two buttons back to those handlers.
- `SA_V2_MIN_ENTRIES = 50`: 50 entries or fewer stay classic; 0 sends every eligible completion to V2.
- **Turning V2 off means republishing the form AND the list.** Turn off the Stock Count Review too (its own switches) or
  reviews keep creating V2 jobs.

Also new on the form, with or without the switch:
- Save as Draft re-reads the stored status and refuses unless the SA is Draft. It used to write directly and could flip a
  Processing SA back to Draft mid-job.
- The status filter and the badges show `Processing` and `Cancelled`.
- The Post button is hidden for Processing / Cancelled.
- Hidden fields `sa_v2_job_id` and `sa_idem_key` were added (the columns exist on dev).

## What the user sees

The form waits for the verdict: it polls STATUS every 2.5 s for up to 180 s and kicks the worker every 15 s.
- **Stock moved** (the job reached 80 %): the form reports that the stock has been adjusted, and phase B finishes in the background.
- **FAILED:** the error is shown and the form keeps its data (an Edit stays open; a new SA closes, since it is already
  saved as a Draft).
- **Still running after 180 s:** the form closes. Opening the SA shows it read-only with a Processing banner and follows the
  job; opening the list kicks the worker (at most every 2 minutes per browser).

There is no Quartz schedule. A job nobody kicks stays queued until someone opens the SA or the list.

## Deliberate differences from the classic completion

- Atomic: all stock moves in one engine call, and the header turns `Completed` after the stock moved (`Processing` meanwhile).
- An invalid `movement_type`, a line with quantity but no entry, and a line over 60,000 bytes are refused before any write.
- Movements carry `operation_effect_key` (`SAC|<job>|M<n>`), so the engine replays safely.
- The engine stores batch-balance `remark` NULL as `''` (cosmetic).
- A review marks the Stock Count lines Adjusted after the stock moved, not before.

**Kept as in the classic (parity, on purpose):**
- the variance basis, prices `|| 0`, `stock_control 0` lines skipped;
- the stored `movement_type` casing;
- "Completed & Post" completes only;
- a form-completed SA linked to a Stock Count marks every Approved line Adjusted.
- **Prices are per base unit, by design.** Every line made in the SA form carries the item's base unit (item selection sets
  it and the unit column is locked; the balance dialog's unit picker converts what you type back to it on confirm), and its
  price defaults to the item's per-base purchase price. Classic and V2 cost an In at that per-base price. Only a document built
  outside the form (an import, the live test kit) can carry an alternate unit; its price is then also taken per base unit.
  Prod has no priced alternate-unit In line (its 12 alternate-unit SA lines are all Outs, checked 2026-10-19).

## Job conventions (shared tables, used unchanged)

- `gd_async_job`: `command COMPLETE_SA`, `correlation_id SA|<saId>`, `causation_id <saId>`. `gd_id` / `gd_no` stay EMPTY, so
  GD_JOB_RECONCILE's gap scan ignores these jobs.
- States: QUEUED → VALIDATING → READY_TO_COMMIT → COMMITTING_SA → COMPLETED / FAILED / REQUIRES_REVIEW.
- Document lock: the SA's `stock_adjustment_status = 'Processing'`, `sa_v2_job_id = <job>`, and the latest `gd_publish_step` row
  `SAC|<saId>` / `LOCK|<n>` holding the job's idempotency key.
- Review guard: `gd_publish_step` `SCR|<scId>` / `LOCK|<n>` (its unique index stops a second review of the same count).
- Engine operation: `SAC|<jobId>` (engine rows `IBA|I|nnn`, `IBA|DONE`, `IBA|REVIEW` under it).
- Parts: `S|<nonce>|…` (SUBMIT), `P|<nonce>|…` (PREPARE); step rows `A0_REVALIDATE` … `A4_FINISH`, plus the `A4_REORDER` marker (a
  retry never books the reorder twice).
- `started_at` stays NULL on these jobs, as on every GD-lineage V2 job (shared worker framework); `queued_at` / `finished_at` are set.

## Locks (engine v10)

The engine locks each bin (`ITEM|<mat>|<bin>`, `BATCH|<mat>|<bin>|<batch>`) and, because every SA movement writes cost rows,
each item's plant-level cost rows (`COST|<material>|<plant>`). A Stock Adjustment and a GD / GR / Putaway V2 completion that share
an item at the same plant run one after the other, even in different bins. The second one waits:
- A2 `SA_LOCK_WAIT`: 15 s, doubling up to 5 min, 8 tries;
- then FAILED `SA_INVENTORY_LOCK_BUSY` with nothing moved.

## The guarded classic save (`STOCK_ADJUSTMENT.json`)

New first nodes, before anything else runs. Refusals answer like the classic's own failures (a return node, `code "400"` + message):
- a stored `Processing` SA → "This Stock Adjustment is being processed in the background - please wait for it to finish.";
- more than 500 entries on a non-Draft save → "This Stock Adjustment has <n> entries. Adjust at most 500 at a time.";
- any line's `balance_index` over 60,000 bytes → "Line <n> holds too many bins…". Prod's non-strict SQL used to truncate such a
  line silently.

The guard reads only `stock_adjustment` (never the job tables). Every other node is byte-identical to v24.

## Error codes

All codes start with `SA_`; the message is what the user reads. Full list: `scratchpad/sav2/CONTRACT.md` §10.
- **FAILED** (phase A, before the stock moved): nothing moved. The SA goes back to Draft (form), or to `Cancelled` (review: the
  SA keeps its number and lines as the audit of the attempt, and a retry creates a new SA). Typical codes:
  `SA_INVENTORY_INSUFFICIENT` ("Insufficient quantity - line 2 (ITEM), bin A1 (Unrestricted)"), `SA_LINES_CHANGED`,
  `SA_INVENTORY_LOCK_BUSY`.
- **REQUIRES_REVIEW**: the job stopped after the stock moved (`SA_RECONCILIATION_MISMATCH`, after 3 retries of a phase B step),
  or the status to restore is unknown (`SA_PREV_STATUS_UNKNOWN`). The SA stays Processing.

## Runbook: a job in REQUIRES_REVIEW

**Why it matters:**
- The engine keeps the operation's locks until it is DONE, including through review. A stuck SA blocks GD / GR / Putaway /
  Location Transfer V2 on its items, and through the COST key it blocks each item in every bin of the plant.
- The SA stays Processing, so its Stock Count stays read-only and its classic saves (mobile too) are refused.

1. Find the job:
   ```sql
   SELECT id, job_status, error_code, error_message, error_details, progress_message
   FROM gd_async_job
   WHERE tenant_id = '<tenant>' AND command = 'COMPLETE_SA' AND correlation_id = 'SA|<saId>'
   ```
   Then list its rows in `gd_publish_step`:
   - `job_id = '<jobId>'`: the `<STEP> DONE` rows, the parts, and the claims;
   - `job_id = 'SAC|<jobId>'`: the engine's `IBA|I|…`, `IBA|DONE` and `IBA|REVIEW` rows.

   `error_details` names the step and why it stopped.
2. **If `IBA|REVIEW` exists**, the engine's read-back did not match.
   1. Compare the balances against the engine's intent rows and fix the data.
   2. Delete the `IBA|REVIEW` row.
   3. Set the job back to `COMMITTING_SA` with `attempt_count = 0`, `lease_owner = NULL` and `next_attempt_at = NOW()`.
   4. Kick `SA_V2_WORKER {"job_id": "<jobId>"}`, or open the SA.

   The engine resumes and skips the rows already at their after-value.
3. **If the engine is DONE but A3 or A4 stopped:** every step is re-runnable. Reset the job as above and kick the worker. A step
   whose rows are already at their after-value writes nothing, and the `A4_REORDER` marker stops a second reorder booking.
4. **Dev:** write through `.dbtools/dbw` (preview, then `--execute`, with a yes). **Prod:** access is SELECT-only, so the repair
   goes through the platform.

**Never point GD_JOB_RECONCILE at COMPLETE_SA jobs.** Its DEAD_PRE and REVIEW branches match any command.

## Tested on dev (tenant 496474, 2026-10-16; kit `scratchpad/sav2/live/RUNBOOK.md`)

| Test | Result |
|---|---|
| Twins, classic vs V2: T1 form Add → Completed (7 lines, 9 entries: FIFO, WA, batch, alternate UOM, In + Out on one key) | no difference in any of 11 tables; 1 worker tick, 2 s |
| T2 Draft → Completed with a header edit and a line edit | no difference (A1 rewrote the edited line) |
| T3 Stock Count Review → SA | no difference, including the count header and its 8 lines |
| F1 an Out larger than the stock | FAILED `SA_INVENTORY_INSUFFICIENT` naming the line, item and bin; nothing moved; SA back to Draft; no lock held |
| 2,000-entry Stock Count Review → SA/20261016/0017 (1,166 lines) | reconciled exactly: 1,968 balance + 40 batch keys, 721 FIFO + 16 WA cost keys, 2,000 keyed movements, every count line Adjusted. Three worker runs: 5 s / 72 s (engine 62 s, 2,712 lock keys incl. 704 COST) / 16 s. Node data ≤ 15 MB per run |
| Cost-row race R0-R3 (`scratchpad/sav2/race/EVIDENCE.md`) | lost FIFO / WA updates without COST locks; 16/16 consistent with engine v8+, first-use seed fixed in v10 |

Not yet run: the browser pass through the real buttons; R4 (a 2k SA V2 job against a GD V2 completion on shared items).
