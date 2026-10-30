# 2026-10-28 Picking V2: re-kick a delivery completion that lost the stock lock (client only)

**Status:** LIVE on dev 10-28 (Picking form v440, list page v226, both IDENTICAL to the repo); the live dev test PASSED.
**PROD LIVE 10-28 18:36-18:38 MYT:** form v184 and list page v77, both IDENTICAL to the pastes (`verify.py`).

## Why (Kenhin 528521, "Pick All Remaining → GD auto complete → invoice is slow")
- **The slow batches:** from Auto Pick & Complete (PKA-) to the last completion:
  - 11:21 (3 GDs) and 11:42 (4 GDs): 14 s.
  - 11:50 (4 GDs): 119 s; 11:57 (5 GDs): 116 s; 15:43 (8 GDs): 339 s.
- **The cause (GD session):** every step runs in seconds. The tail is one or two completions that lost the stock lock to a
  sibling. C2 then parks the job (GDC_LOCK_WAIT, `next_attempt_at` = now + 15 s, 30 s, 60 s ... 300 s) and waits for a kick.
- **Nothing kicked it:** the screen starts each completion only once, so a parked job waited for a list's sweep. Example: job
  2115348868832038913 (GD/20261028/2232), C1_SNAPSHOT 07:44:16 UTC → W0_CLAIM_4 07:49:26 UTC.

## The fix: no workflow change
- **Where:** the Picking form's Save as Completed (`Picking/AsyncV2/pkV2_onSave_Completed.js`, form eventScript 14) and the
  Picking list's Auto Pick & Complete (`Picking/AsyncV2/pkV2_listAutoPick.js`, list page eventScript 24).
- **When:** after the existing follow has started each queued completion (`followGdCompletes`) and the Picking STATUS list is
  stable, `rekickGdCompletes` runs every 15 s, at most 12 times (3 min).
- **Each round:**
  - GD_COMPLETE_SUBMIT 2110182609618337794 `{ operation: "STATUS", gd_id, source: "PICKING" }` for each started delivery
    still followed. STATUS reads only; it writes nothing.
  - A delivery is dropped once its completion is COMPLETED, FAILED or REQUIRES_REVIEW. QUEUED, VALIDATING, READY_TO_COMMIT,
    COMMITTING_GD, or no answer, keep it followed.
  - While any is still followed: one GD_COMPLETE_WORKER 2110182645714518018 `{}`. That run takes the tenant's due jobs one
    after another (at most 5), so the siblings stop racing each other for the lock.
- **Throttle:** at most one kick per 14 s per browser, shared with the Picking list's 60-s sweep (localStorage
  `pkv2_gdc_kick_at`). Several followed Pickings (one Auto Pick & Complete click over many) still send one kick per round.
- **Cost per confirm:** about 0.6 s of server time per STATUS read (prod average), only for deliveries still open, plus at
  most one worker run per 15 s per browser. Past 3 min the lists' sweeps take over, as before.

## Evidence
- **Tests** (RED before the change, GREEN after):
  - `scratchpad/pk1e/test/test_client_list.js`: 16/16, including the 9 re-kick cases (one still running, the finished one
    not read again, FAILED / REQUIRES_REVIEW, no answer, the 12-round cap, the shared throttle both ways).
  - `scratchpad/pk1c/test/test_client_1c.js`: all pass (3 new re-kick cases on the form).
  - Unchanged and still passing: `test_list_mounted.js`, `test_client_1d.js` 19/19, `test_p7.js`, `test_p7_nodes.js`.
  - `scratchpad/pkv2-legacy/test_client.js` fails 1 case ("a bin move: classic save"); it fails the same on the committed
    handler, because stage 1c moved bin moves to V2.
- **Dev STATUS call** with the tail's exact params (GD/20260929/564): `job_status` COMPLETED, 218 ms.
- **Live on dev, PASSED 10:33 UTC** (`scratchpad/pk1e/test/live_follow_dev.js 2110996128710393858 1123598813738675201
  --drop-start`). It runs the list's real follow code against the dev workflows, withholding the per-job start as if it had
  lost the lock:
  1. 10:33:13: Auto Pick & Complete on PI-20261016-0353 was QUEUED; by 10:33:16 STATUS was COMPLETED with
     [GD/20261016/591 QUEUED]. The start was withheld at 10:33:17.
  2. 10:33:26: the follow ended after 3 stable polls.
  3. 10:33:41, re-kick round 1: GD STATUS QUEUED → one GD_COMPLETE_WORKER `{}` at 10:33:42. That run (2115391549724868609,
     3.0 s, the test's CLI user, the only worker run in the window) claimed the job (W0_CLAIM_0 the same second).
  4. 10:33:57, round 2: GD STATUS COMPLETED → the follow stopped.
  5. Result: GD/20261016/591 Completed (job 2115391438508703746, attempt 0); PI-20261016-0353 Completed and unlocked.

## Prod paste: 2 items, either order
1. **Picking form** `transfer_order` 1935556443668959233: paste `PickingFullJSON.prod_paste.json`. Built on prod enabled v183;
   only eventScript 14 changes.
2. **Picking list page** 1935635853539348481: paste `PickingListPageFullJSON.prod_paste.json`. Built on prod enabled v76
   (it keeps prod's own designer property); only eventScript 24 changes.

- **After:** `python3 verify.py`. Both must say IDENTICAL.
- **Open tabs keep the old code until they reload.**
- **Rollback:** paste `PickingFullJSON.prod_v183.base.json` / `PickingListPageFullJSON.prod_v76.base.json` back.

## Files
- `pull.py`: pulls the enabled dev / prod form and list page and compares them with the repo files.
- `build.py`: puts the two handlers into the repo files (= dev) and builds the prod pastes. It asserts each base still holds
  the committed handler and that nothing else changes.
- `verify.py`: prod enabled vs the paste files.
- `wf_upload.dev.plan.json`: the dev publish (bases dev v439 / v225).
