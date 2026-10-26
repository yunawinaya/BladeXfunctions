# 2026-10-26 07:35 GD creation: retry stock-lock conflicts 60 times instead of 20

> **PARTLY SUPERSEDED.** GD_ASYNC_WORKER.json and GD_JOB_RECONCILE.json here are what prod runs (v15 / v9). GD_BULK_COMMIT.json here is SUPERSEDED by `../2026-10-26-gd-commit-oldest-first-v3/` (prod v28): do not paste it.


Follow-up to `../2026-10-26-gd-create-lock-retries/` (6 -> 20, live 07:19). Same files with one more constant change.

## Why
After 07:19 no creation failed, but big GDs kept losing the stock race.
- Each stock call first checks that all its keys (33-81 here) are free, then takes them one by one.
- A smaller GD that grabs one of those keys mid-way sends the big one back, which counts as a retry.
- GD-2610-1466 (SO-Jimmy-040849, 45 keys) reached retry 13 in 12 minutes while smaller GDs completed. 20 would have run out
  around 07:37.
- LOCK_CONFLICT means nothing moved, so retrying longer is safe. A lock that never frees shows in the watch (locks held 10+ min)
  long before retry 60.

## Change
`GDC.retry.max_retries` 20 -> 60 in the same 9 nodes:
- GD_BULK_COMMIT: 2
- GD_ASYNC_WORKER: 6
- GD_JOB_RECONCILE: 1

About 48 minutes of trying. Checked by script against the live prod versions (the 20 files): nothing else differs, and the lint
output is identical. `test_max_retries_20.js ... 60` passes: retries through 60, clean failure after 60.
Script: `scratchpad/gdc/gdcreate/patch_max_retries_60.py`.

## Paste (prod)
| Workflow | prod id | live before | file |
|---|---|---|---|
| GD_BULK_COMMIT | 2104840402446245890 | v23 | GD_BULK_COMMIT.json |
| GD_ASYNC_WORKER | 2104840667119411201 | v14 | GD_ASYNC_WORKER.json |
| GD_JOB_RECONCILE | 2105133877053263874 | v8 | GD_JOB_RECONCILE.json |

GD_BULK_COMMIT is the one that decides, so paste it first. Jobs already retrying get the new limit at their next retry.
