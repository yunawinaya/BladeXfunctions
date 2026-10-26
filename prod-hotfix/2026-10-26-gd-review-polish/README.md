# 2026-10-26 review polish of the day's GD creation fixes (GD_BULK_COMMIT + GD_ASYNC_WORKER + GD_JOB_RECONCILE)

The day's fixes went out under pressure (retry limits, the same-operation retry, oldest-first). This is the reviewed version.
Findings came from my own review plus an independent one, and each was checked against prod data before it was fixed.

## Paste (prod)
| Workflow | prod id | live now | file | differs only in |
|---|---|---|---|---|
| GD_BULK_COMMIT | 2104840402446245890 | v28 | GD_BULK_COMMIT.json | sql_node_kY5OLfvj, code_node_7NQFbpmU |
| GD_ASYNC_WORKER | 2104840667119411201 | v15 | GD_ASYNC_WORKER.json | 6 nodes: retry limit 60 -> 200 |
| GD_JOB_RECONCILE | 2105133877053263874 | v9 | GD_JOB_RECONCILE.json | 1 node: retry limit 60 -> 200 |

Order: GD_ASYNC_WORKER and GD_JOB_RECONCILE first, then GD_BULK_COMMIT. Any order is safe; this one avoids even a minute of
the worker failing jobs at 60 that the commit would retry to 200.

## What changes
1. **Oldest-first matched on non-stock lines.** It used to match lines with no location (delivery charges, unallocated
   lines): 82 rows in 76 of 245 LSH GDs today, e.g. item 3011-001. GDs sharing only such a line queued behind each other.
   Now only VALID, allocated rows with a material and a location count.
   - Checked on prod: a real pair sharing only 2105-044 (no location) was "overlap" before and is not now. A pair sharing
     3005-006 at a real bin is "overlap" in both.
2. **Retry limits aligned to 200.** The worker and reconcile used 60. One dead run after retry 60 exhausted a job the
   commit still allowed: Pick clamps a dead claim's count to min(n+1, 60) and Claim exhausts at >= 60, on one shared
   counter.
3. **A stuck head no longer blocks the queue.** Older jobs with 30 or more retries (about 25 min) are ignored by
   oldest-first, so one permanently blocked GD cannot hold the others for hours.
4. **Calls that fail before anything is recorded** (no operation row) get their own budget: 6 in a row (counted in
   error_details.call_failures), then a clean failure. Nothing was recorded, so nothing is held. On the shared limit of 200
   a permanent fault took about 2 h to surface.
5. **Liveness is timezone-free.** It now uses next_attempt_at within 3 minutes or a live lease (DB clock, UTC on prod, MYT
   on dev, compared with NOW(3)). The old app-clock update_time plus a hard-coded +8 h was right on prod only and never
   true on dev.
6. **The check is lazy and cheaper.** It is evaluated only before a fresh stock call (no operation row, P3 not DONE). EXISTS
   replaces COUNT(*) > 0. IFNULL(..., '') returns "no waiter" as ''. EXPLAIN on prod uses an index for all four tables
   (job_status, Job Step, Stage Line x2): 0.37 s for the whole facts read.
7. **retrySame at the limit:** up to 2 more same-operation calls, so RECOVER still releases the keys. Then the next pass
   fails cleanly on the REJECTED operation. Past that, review naming the stuck operation and "no stock moved". It used to
   fail into review with a false "stock moved" and the keys held.

## Tests
- `scratchpad/gdc/gdcreate/test/test_commit_same_op.js`: 14 pass, including limit+1 same operation, limit+3 review, and the
  unrecorded-crash budget at 1 / 6 / 7.
- `test_commit_fifo.js`: 5 pass. `test_max_retries_20.js` now reads the limit from the file (200): pass.
- Prod read-only SQL: the overlap pair test above, the four liveness cases, EXPLAIN, timing.
- Lint: no new findings vs the prod versions. The new rule SQLCOLUMN (scratchpad/validate.py) flags a selected column that
  another node reads but the node's response_json omits. It catches the v26/v27 mistake; clean on every V2 workflow.
- Dev: published (GD_BULK_COMMIT v31, GD_ASYNC_WORKER v19, GD_JOB_RECONCILE v10, identical to these files).
  - End-to-end at 09:30:
    1. dev test GD/20261026/623 was cancelled through GD Cancel V2 to free its SO;
    2. SO_AUTO_GD SO/20260720-062 gave V2 job 2114530150060445697;
    3. the worker took it to COMPLETED: GD/20261026/624 Created.
  - The platform ran the new facts SQL and returned `"older_waiting": ""`, proving the SQL, the declaration and the
    empty-not-dropped value.

Scripts: `scratchpad/gdc/gdcreate/patch_commit_polish.py`, `patch_max_retries_200.py`.
