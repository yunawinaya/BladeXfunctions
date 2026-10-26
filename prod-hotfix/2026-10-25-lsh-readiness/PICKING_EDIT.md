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

## 10-26 morning: P4 header race fixed on prod

- **Found at 06:42:** one LSH web Auto Pick job (10-25 16:07, PI-2610-3490) waited 2 min 50 s for a worker kick.
  - P4 read back a delivery header that a sibling job (Pickings sharing the delivery, Full Picking) had written from newer
    facts, called it a mismatch, and retried.
  - Only a Picking list or form open moves a retry.
- **Also:** retry rows concatenated attempts / row_version as text.
- **Fixed in PICKING_BULK_COMMIT (2109531367339180034):**
  - P4 accepts a header holding the fresh roll-up; a real mismatch still retries.
  - Retry rows read numbers.
- **Status:**
  - Dev v14 06:52 + smoke passed (PI-20261022-0106, 9 s, P0-P5 DONE, row_version 6).
  - **Prod v14 pasted 06:54:13, IDENTICAL.**
  - Folder `prod-hotfix/2026-10-26-picking-p4-sibling/`.

## 10-26 11:10: mobile V2 Picking live on prod

- **Volume:** 288 app V2 confirms (`PKC:` keys) from 14 LSH users since 07:10:45, plus 3 web. All COMPLETED; the longest
  took 29 s.
- **The planned first device run** is superseded by real traffic on the Picking side.
- **PACK-2610-1012** (Packing's item): an app V2 confirm's P5 added 2 lines at 10:57:49.9, then a stale-copy classic
  PACKING_SAVE wiped them at 10:59:04. P5 bumps packing.update_time, so a stale copy is detectable. GD-2610-1175 is fully
  picked.

## 10-26: one job per worker run (the stock-lock rule)

- **The rule:** the platform's stock lock lasts until the top-level run ends, so a worker run makes at most one stock call
  and takes no further job after it.
- **My workers:** each job makes one stock call (GD Edit E1; Picking PM1, moves only; the PLANs take no locks). But
  id-less runs took up to 5 jobs.
- **Fix:** LIMIT 1 in both polls.
  - Dev: GD_EDIT_WORKER v9 and PICKING_ASYNC_WORKER v6 at 11:02, idle smokes OK.
  - Prod: GD_EDIT_WORKER **with the stock-lock batch** (`prod-hotfix/2026-10-26-gde-worker-one-job/`).
  - Prod: PICKING_ASYNC_WORKER after the peak (`prod-hotfix/2026-10-26-picking-worker-sweep-skip/`, now with the 10 s skip
    and LIMIT 1).

## 10-26: worker claim races (harmless crashes, possible error pop-up)

- **Seen:** PICKING_ASYNC_WORKER crashed 3 times at the claim insert at LSH (07:22 x2, 07:28). The other run did each job;
  nothing ran twice.
- **Fix:** list-open id-less runs leave a job to its own kick for its first 10 s and 10 s after it comes due. Same rule
  as the GD session's creation-worker fix.
- **Status:** dev v5 07:49, idle smoke OK. Prod paste **after LSH's peak** (the user's call):
  `prod-hotfix/2026-10-26-picking-worker-sweep-skip/`.

## "Can it happen again" sweep (10-25 evening, read-only on prod)

Verdict: no Picking / Edit incident can recur as it was. The classic header wipe ends as phones take the OTA, and three
low items remain.

1. **Past incidents, all fixed and live.** Prod = repo for PICKING v155, PICKING_LOOP v89, PICKING_ASYNC_* /
   PICKING_BULK_* / PICKING_FC_DRIVE and GD_EDIT_* (SUBMIT, PREPARE, WORKER, COMMIT v12). That covers:
   - 2,000-line GD re-save (V2 never re-saves a GD; classic refuses above 500 lines);
   - the 300-GD Picking (below);
   - the PICKING_LOOP lock leak (LockGate, 900 s takeover);
   - the GD V2 picking_status blank (GD_BULK_PREPARE v18) and the consumer twin crash (v14);
   - the `%%` date in P5 (COMMIT v13);
   - the E5 'undefined' add, the unit guard and the custom_fields review in GD Edit V2.
   - Since 10-23, every run of every V2 Picking / Edit workflow completed. Longest: COMMIT 8.8 s, worker 17.9 s, GD
     Edit COMMIT 5.7 s.
2. **The 300-GD Picking class.**
   - **Classic** (phones on 1.1.34): the sibling-read timeout is fixed in PICKING v155 (set-based `SibRecs`), the stamp
     storm in PICKING_LOOP v89 (`StampState`), and SO_AUTO_GD's whole-batch death on 10-13.
   - Picking lines and records now have an index on transfer_order_id, so per-Picking reads are cheap.
   - LSH classic runs since 10-23 are all under 45 s. The slow (137 s) and failed classic runs were at 528521
     (Auto Complete GD) and 073522, not LSH.
   - **V2:** never re-saves a GD, makes Packings in chunks of 25 deliveries, and a first confirm of 2,000 lines passed
     on dev.
   - **LSH reality:** 857 Pickings since 10-13, at most 11 deliveries (1.8 on average).
   - **Residual, low:**
     - (a) Convert to Picking has no cap, so a "Non Split" convert of hundreds of deliveries can still make one huge
       Picking.
     - (b) Repeated partial confirms of such a Picking read lines x records.
     - (c) V2 Force Complete's facts read (`sql_node_PSfc`) scans the GD lines once per delivery, about 0.11 s each
       (1.25 s measured on LSH's largest Picking), so a Force Complete of 270+ deliveries would hit the 30 s limit.
       LSH's Force Complete is classic anyway.
     - Guidance: don't convert more than about 50 deliveries into one Picking. A cap or the derived-table rewrite can
       follow after 10-26 if wanted.
3. **LSH leftovers: clean.** I checked for:
   - open or under-review EDIT_GD / CONFIRM_PICKING jobs;
   - deliveries in Processing with no open job;
   - held Pickings;
   - a delivery picking-Completed with open rows on a live Picking;
   - a delivery whose lines all read picked but whose header doesn't;
   - open rows of cancelled deliveries.
4. **SQL over unindexed tables:**
   - No `IN (SELECT … UNION …)` in my 12 workflows.
   - Correlated per-row subqueries exist only on gd_async_job (1.5k rows, cheap) and in PSfc / PSmove / PPmove (per
     delivery, above). PSmove and PPmove cover only deliveries with moved lines.
5. **Still happening: the classic header wipe.**
   - Classic PICKING writes 49 Picking header columns from what the phone sends, and the old app sends few of them.
   - Since 10-23, 0 of 769 classic-confirmed LSH Pickings keep their `delivery_method`, against 50 of 88 V2-confirmed.
   - **Ends with the OTA, per phone.** V2 confirms write stored + patch, and sudu-mobile-expo-f1 confirmed the branch's
     classic fallbacks send each Picking's full stored header plus edits:
     - swaps, splits and Draft: `buildPickingClassicPayload`, 49 = 49 HEADER_FIELDS, dev-verified 10-20;
     - Force Complete: the whole stored record.
   - Phones still on 1.1.34 keep wiping until they update.

**Does an updated phone still call PICKING_LOOP?** Yes, in two ways:
- **After a NOT_ELIGIBLE answer from PICKING_ASYNC_SUBMIT.** At LSH that is a pick moved to another bin or batch (moves
  are not ported for Full Picking) and Force Complete (with `isForceComplete`).
  - No job row is created. The marker is a PICKING_ASYNC_SUBMIT run for the same `picking_id` that answered NOT_ELIGIBLE
    seconds before the PICKING_LOOP run.
- **Directly, with no SUBMIT:** rows split over several locations, and an unsaved or Draft Picking. These carry no
  marker, but none appeared in a prod week of mobile confirms.

## First prod device run after the OTA (before volume)

The Picking part of the run; it comes first, and its delivery then goes on to the Packing part in PACKING.md.

- **What you need:**
  - One phone with the OTA applied, logged in as an LSH user.
  - One small LSH Goods Delivery (1-3 lines), Created and not yet converted (picking status Not Created). LSH's own test
    SOs ("Joseph Testing …") fit.
- **Setup:** on the web GD list, Convert to Picking for that one delivery. LSH runs Full Picking, so the split dialog
  opens; make one Picking and assign the phone's user.
- **How I take part:** tell me (GD Edit & Picking V2) when you start. I check each step read-only on prod and answer pass
  or fail within a minute.

| # | On the phone | Expect | I check |
|---|---|---|---|
| 1 | Open the Picking, pick every line from its allocated bin (no bin or batch swap), tap **Completed** | A toast that it is being saved in the background; the Picking reads Completed within about 30 s | One CONFIRM_PICKING job, key starts `PKC:`, COMPLETED; steps P0, P1, P3, P4 and P5 DONE; Picking Completed and unlocked; records = lines; GD lines and header picking Completed; a Created Packing for the delivery (Packing's step 1 starts here); no PICKING_LOOP run for this Picking |
| 2 | On a second small Picking, tap Completed twice quickly (or turn on airplane mode right after the tap, then retry) | One save only; one result shown | One job only (same `PKC:` key -> EXISTING) |
| 3 | *If a phone still on 1.1.34 is at hand:* confirm a Picking on the updated phone, and open the same Picking on the old phone while the job runs | The old app refuses: the Picking is in use / under processing | No PICKING_LOOP write lands on it (PICKING_LOOP v89 treats the open job as the lock) |
| 4 | Close the app right after tapping Completed on a third small Picking, then reopen it after 1 minute | Reopening or the list shows the job's result; it finishes even with the phone closed | The job COMPLETED; its worker kick came from the reopen or the list, if not before |

**Not on prod:**
- A bin or batch swap. At LSH (Full Picking) it goes to classic PICKING_LOOP by design, and staging one moves real
  stock.
- Force Complete. LSH is a Full Picking org, where V2 Force Complete is parked, so it stays classic.
- A large Picking. LSH's largest since 10-13 has 11 deliveries; the 2,000-line case passed on dev.

Watch those as they happen naturally.

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
