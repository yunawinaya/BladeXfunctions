# 2026-10-26 GD creation: retry stock-lock conflicts 20 times instead of 6

## Why
LSH (128671) converted about 28 SOs at 06:51 and about 20 more from 07:05.
- Every GD's stock step needs 42-78 balance keys and holds them about 19 s on average (47 s at most).
- GDs needing the same items therefore queue behind each other. A GD that keeps meeting a held key gives up after 6 retries,
  about 4 minutes: `GD_TRANSIENT_RETRIES_EXHAUSTED` "inventory LOCK_CONFLICT after 6 retries".
- 7 SOs failed this way by 07:11. Each failure was cleaned up (header soft-deleted, no lines, no reservations), so the SO can
  be converted again.
- Nothing was stuck. The locks moved the whole time; the bursts just needed longer than 4 minutes to drain.

## Change
`GDC.retry.max_retries` 6 -> 20 in every node that reads it:
- GD_BULK_COMMIT: the P3 decisions before and after the inventory call;
- GD_ASYNC_WORKER: pick, claim, exhaust, after prepare, after publish, after the second publish;
- GD_JOB_RECONCILE: decide.

The backoff is unchanged (min(30 s, 2 s x 2^n)). Retries 7-20 come about every 50 s, so a GD keeps trying for about 17 minutes
instead of about 4. Nothing else changes: the files equal the live prod versions with that one constant replaced (checked by
script), and the same edit was made on 10-23 for 3 -> 6. Script: `scratchpad/gdc/gdcreate/patch_max_retries_20.py`.

## Paste (prod)
| Workflow | prod id | live before | file |
|---|---|---|---|
| GD_BULK_COMMIT | 2104840402446245890 | v22 | GD_BULK_COMMIT.json |
| GD_ASYNC_WORKER | 2104840667119411201 | v13 | GD_ASYNC_WORKER.json |
| GD_JOB_RECONCILE | 2105133877053263874 | v7 | GD_JOB_RECONCILE.json |

Any order works. GDs already retrying pick up the new limit at their next retry.

## Deployed 2026-10-26
- **Prod (user paste):** GD_ASYNC_WORKER v14 07:17:54, GD_BULK_COMMIT v23 07:19:04, GD_JOB_RECONCILE v8 07:20:30. All three
  IDENTICAL to the repo. No other workflow changed; the only other paste in the hour was PICKING_BULK_COMMIT v14 (42's, 06:54).
- **Dev (wf_upload, backups in `~/Documents/ASC-dev/workflow-backups/dev/<name>/`):** GD_BULK_COMMIT v23, GD_JOB_RECONCILE v8,
  GD_ASYNC_WORKER v17, all at 07:19. Plan: `scratchpad/gdc/gdcreate/deploy_max_retries_20/publish.json`.

## Tests
- Offline, `scratchpad/gdc/gdcreate/test/test_max_retries_20.js`, on the real P3 decision code:
  - the patched file retries through retry 20 (2 s, 4 s, then every 30 s) and fails cleanly after 20;
  - the old prod version fails at 6, so the test sees the difference;
  - the before-call and after-call copies of the rule are identical.
- `test_commit_catch.js`: 12 pass. One case changed, as expected: "used up at 6" now retries.
- Dev smoke (07:24): SO_AUTO_GD SO/20260922-071 -> V2 job 2114498847139221505 -> worker v17 -> COMPLETED, GD/20261026/618
  Created in 7.8 s, 12 steps DONE.
  - An earlier try with SO/20261023-058 went classic: handling units at that plant hold the item. It created
    GD/20261026/617 on dev.
- Prod after the paste: GD_BULK_COMMIT ran 258 times from 07:19:05 with no failure, and no creation has failed since.
  - The last failures were 07:14:14 and 07:17:44, both before GD_BULK_COMMIT went live.
  - No job had needed more than 6 retries at the time of the check.

## SOs to convert again (failed before the paste, checked 07:25)
14 failed today. 7 already have a live GD, redone by LSH: GD-2610-1412, 1413, 1451, 1452, 1453, 1456 and 1457.
These 7 still need converting:
- SO-Jane-06915, SO-Jimmy-040853, SO-Lee-029864, SO-Lee-029887
- SO-Tom-035949, SO-Tom-035964, SO-Yun-08635

## Not in this paste (follow-up)
Worker runs that lose a claim race fail with `Duplicate entry ...-W0_CLAIM_n` (6 on 10-26). This is the claim gate working:
the losing run stops, and nothing is written twice. It happens because several runs wake for the same job at its retry time.
The fix (only a job's own run retries it, a random 0-2 s spread on the wake-up, and other runs leave a job alone for 10 s after
its retry comes due) is a separate GD_ASYNC_WORKER change, to test on dev first.
