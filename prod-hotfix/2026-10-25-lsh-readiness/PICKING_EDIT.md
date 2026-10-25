# GD Edit V2 + Picking V2: LSH readiness for 2026-10-26

Owner: session bladexfunctions-42 ("GD Edit & Picking V2"). Prod facts read 2026-10-25 (read-only). Workflows named with
their ids, per README rule 1:

| Workflow | Id |
|---|---|
| GD_EDIT_WORKER | 2110618789356687361 |
| GD_EDIT_COMMIT | 2110618866011787266 |
| PICKING_ASYNC_WORKER | 2109531412499251201 |
| PO_SAVE | 2069257894280118274 |

## Summary

Nothing in my area blocks tomorrow, and no user action is open. Prod pasted 10-25 13:31 / 13:33, both IDENTICAL; health
check after the pastes clean for my jobs.

| # | Item | Risk for LSH tomorrow | Dev | Prod |
|---|---|---|---|---|
| 1 | Worker budget (README 1b) | None: no stall on desktop | no change | no change |
| 2 | Edit vs cancel on a shared Picking (README 2b) | Low: a false review, no lost data | GD side adds a wait (in its cancel fix) | with that fix |
| 3 | E2 custom_fields review (README 2c) | None for LSH: only 502801 is affected | **v12 live 13:18**, live smoke passed | **v12 live 13:31:06**, IDENTICAL |
| 4 | PO line arrival dates (BA LSH-OPS-09) | Data only: 90 earlier LSH PO lines without a date | v46 live | fix live; backfill **skipped** (user, 10-25) |
| 5 | GD_REVERT_WORKER budget 20 -> 240 s (taken for this fix only; GD Revert V2 is c8's) | None: 0 jobs on prod | **v6 live 13:26**, idle smoke OK | **v6 live 13:33:32**, IDENTICAL |
| 6 | Mobile V2 OTA (`hotfix/v2-background`): Picking client | Low after the mobile fixes | fixes in 2b9c7e55, pushed (PR #663), OTA-eligible | merge + OTA: the user's call |

## 1. Worker budget (README 1b)

- **What it is:** GD_EDIT_WORKER and PICKING_ASYNC_WORKER start no new job after 20 s in a run, like the others.
- **Why it does not stall here:**
  - Every client kicks with its own job id: the GD form edit, the SO save cascade, the Picking form, and Picking Force
    Complete.
  - Both polls then select only that job (`jobId = 0 OR j.id = jobId`). The budget limits only id-less sweeps
    (list-page mounts).
- **Evidence, prod since 10-22, all tenants:**
  - 76 CONFIRM_PICKING and 81 EDIT_GD jobs. All COMPLETED.
  - First claim within 0-5 s.
  - LSH Picking jobs (61 Pick All Remaining, 1 Confirm) run 4 s on average and 12 s at most.
  - LSH edits (73) finish within 20 s.
- **Status:** no change, unless the user wants every worker aligned.

## 2. Edit vs cancel on a shared Picking (README 2b)

- **Risk:**
  - While a GD Edit V2 job holds a Picking (`is_processing = 1`), its E5 step requires the Picking's update_time to still
    be the locked one.
  - A sibling GD's cancel writing that Picking (X5 delivery_no token, X4P status) moves it, and the edit goes to
    REQUIRES_REVIEW.
  - It is a false review: the GD stays Processing until it is resumed by hand. No data is lost.
- **Who else writes a held Picking:**
  - PACKING_SAVE never writes the Picking table (1935556443668959233).
  - Picking V2 and classic PICKING_LOOP refuse a held Picking.
  - So the sibling cancel is the only writer found.
- **Fix:** the GD side makes X4P / X5 wait while the Picking is held (retries 2 / 4 / 8 s; an edit takes under 20 s). It
  ships with its cancel fix (README item 2).
- **My side, decided against for tomorrow:**
  - Making E5 compare only its own columns would change how E5 detects lost updates, the day before peak volume.
  - With the wait in place, no writer is left.
  - Revisit after 10-26 if a false review is ever seen.

## 3. E2 custom_fields review (README 2c)

- **Bug:**
  - The platform stores a line's custom fields by definition id and reads them back by name.
  - GD Edit V2's E2 writes them by name, then compares its raw read-back by key. They never match, so the edit goes to
    review.
- **Who:**
  - Only tenants with GD line custom-field definitions. On prod that is 502801 alone (4 kamco fields).
  - LSH has none, so it is not exposed. 900938 stores its fields by name and passes.
- **Seen once:**
  - GD2610-0654 (502801), 10-23 16:23.
  - Hand-fixed 10-24 10:09: the payload part was re-keyed by id and the job resumed.
- **Fix (built, tested offline):**
  - E2's reads also return the line table's definitions.
  - Its comparisons translate ids to names, as the platform reads them.
  - The write is unchanged.
  - Replayed on the recorded prod reads of GD2610-0654: it passes with the fix and ends in review on v11, as on prod.
- **Status:**
  - Dev: GD_EDIT_COMMIT (2110618866011787266) v12 is live since 13:18:45 (the user's yes) and IDENTICAL to the repo.
  - Live smoke as admin@496474: GD/20261022/115 line 1 2 -> 1 completed in one worker call. E0-E7 DONE, and only the
    expected writes. E2's read-back carried the definitions row (empty for 496474).
  - Prod: v12 pasted 13:31:06 from `prod-hotfix/2026-10-25-gde-custom-fields/` and IDENTICAL to the repo.

## 4. PO line arrival dates (BA LSH-OPS-09)

- **Fix:**
  - PO_SAVE takes the header date for a blank line date.
  - Prod v23 was pasted 10-24 12:47:56 and is IDENTICAL to `prod-hotfix/2026-10-24-po-line-expected-date/PO_SAVE.json`.
  - Since then, 24 LSH lines on 3 POs were saved, all with their header date.
- **Backfill: skipped** (user, 10-25). The 90 earlier LSH lines on 46 POs keep no date. A re-save of such a PO now fills
  them from the header. `backfill.sql` stays in the folder if it is ever wanted.

## 5. GD_REVERT_WORKER (id 2112758130420088833)

- **Ownership:** GD Revert V2 is session c8's, which is not running. On the user's say-so (10-25) I took this one fix, the
  run budget; GD_REVERT_SUBMIT / PREPARE / COMMIT are untouched.
- **Change:** 20 -> 240 s, the 5 constants in place (as GD_COMPLETE_WORKER), plus the builder source.
- **Effect:**
  - Bulk Revert Completed and the GD form kick each job by id, so they never stalled.
  - The gain is for id-less list sweeps. 0 REVERT_GD jobs on prod since 10-22, so there is no risk either way tomorrow.
- **Status:**
  - Test `scratchpad/gdrev/test/test_worker_budget.js`: RED on v5, GREEN on the fix.
  - Dev: v6 live since 13:26 (the user's yes), idle smoke OK (worker_route IDLE, nothing written).
  - Prod: v6 pasted 13:33:32 and IDENTICAL to the repo. GD_REVERT_* handed back (to c8's area) after this fix.

## 6. Mobile V2 OTA (`hotfix/v2-background`), the Picking side

- **The release:** the OTA moves the app's Picking, Packing and Putaway to V2 and adds the Item Assembly fixes. It is
  JS-only, and the update is forced (a "Update Now" modal that cannot be dismissed).
- **Review:** session sudu-mobile-expo-9a found the Picking client matched the contract, with one HIGH gap:
  - it never followed a job after QUEUED; it now follows by `{ job_id }` until the job ends;
  - plus the list drain loop, kick and STATUS timeouts, and a double-toast guard.
  - The user committed the fixes (10-25).
- **Old and new phones together:** safe per Picking. Prod PICKING_LOOP v89 treats an open CONFIRM_PICKING job as the
  Picking's lock, and SUBMIT refuses a Picking a classic device holds.
- **Telling app jobs from web jobs:** app keys are `PKC:` / `PKF:` (colons), web keys `PKA-` / `PK-` / `PKF-` (dashes).
- **Putaway:** the mobile follower is covered (followPutawayJob, commit 2b9c7e55, pushed to PR #663; OTA eligibility
  exit 0). Server side done by session "PO GR Putaway V2" (its PUTAWAY.md): guide corrected, prod = repo by id, 20 s worker kept
  (the user's decision), classic PUTAWAY_LOOP v19 refuses a TO with an open V2 job. Nothing to paste.
- **Low, left as is:** web Auto Pick kicks each job once with no follower. On prod, all 61 LSH Auto Pick jobs finished
  within 15 s, and Pick All Remaining makes no stock moves, so it has no lock waits.

## What I watch tomorrow

Run this every hour with `prod_health.py`. It should return no rows. It lists my LSH jobs that are under review or failed,
and open jobs older than 2 minutes (a held SO-cascade edit counts only after 20 minutes):

```sql
SELECT command, job_status, gd_no, picking_no, error_code, LEFT(error_message, 120) AS why, create_time, update_time
  FROM gd_async_job
 WHERE tenant_id = '128671' AND is_deleted = 0 AND command IN ('EDIT_GD', 'CONFIRM_PICKING')
   AND create_time >= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR) - INTERVAL 1 DAY
   AND (job_status IN ('REQUIRES_REVIEW', 'FAILED')
        OR (job_status NOT IN ('COMPLETED', 'CANCELLED', 'HELD')
            AND create_time < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR) - INTERVAL 2 MINUTE)
        OR (job_status = 'HELD' AND create_time < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR) - INTERVAL 20 MINUTE))
 ORDER BY create_time;
```
