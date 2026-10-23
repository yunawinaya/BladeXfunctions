# GD Created V2: jobs move without waiting for clicks, and get 6 retries (2026-10-23)

| # | Prod workflow | File here | Base on prod |
|---|---|---|---|
| 1 | **GD_ASYNC_WORKER** (2104840667119411201) | `GD_ASYNC_WORKER.json` | v11, the REJECTED change pasted 10-23 12:41; identical to dev v11 |
| 2 | **GD_BULK_COMMIT** (2104840402446245890) | `GD_BULK_COMMIT.json` | v19, identical to dev v19 |
| 3 | **GD_JOB_RECONCILE** (2105133877053263874) | `GD_JOB_RECONCILE.json` | v6, identical to dev v6 |

Paste all three in the same session; the order doesn't matter.

## Retries: 3 → 6 (all three files)

`GDC.retry.max_retries` goes from 3 to 6 in every node that decides with it:

- GD_BULK_COMMIT, in the P3 decisions before and after the inventory call;
- GD_ASYNC_WORKER, in pick, claim and exhaustion (6 nodes);
- GD_JOB_RECONCILE.

LSH's GD-2610-1086 and 1087 completed on attempt 3 of 3 under lock contention on a busy item; a fourth conflict would have failed them (GD_TRANSIENT_RETRIES_EXHAUSTED). The backoff is unchanged: 2, 4, 8, 16, 30 and 30 s.

GD_PICKING_OUTBOX_CONSUMER carries the constant but never reads it, so it is untouched. The patch is `scratchpad/gdc/gdcreate/patch_max_retries.py`, and lint is identical on all three.

**Dev:** GD_BULK_COMMIT v20, GD_JOB_RECONCILE v7 and GD_ASYNC_WORKER v14, published 13:17. An end-to-end save after the publish completed (GD/20261023/612).

## Why

There is no background timer (no Quartz, by design). A job moves only when a worker runs, and a worker ran for only two reasons:

- **a save**, whose kick processed only its own job;
- **a Goods Delivery list open**, which sweeps due jobs.

At LSH, crashed or conflicted jobs waited for someone to open the list, and every lock conflict cost two more kicks: one to recover the operation, one to apply.

## What changes

1. **A save's kick also sweeps stale due jobs.** Besides the kicked job, the poll (`sql_node_RaVfenlh`) takes due jobs that are at least 10 s stale:
   - the next attempt is 10 s or more past;
   - or the dead lease is 10 s or more past;
   - or the job was never started and is 10 s or more old. Age is measured by the snowflake id, so no time zone is involved; job times on prod are UTC, and dev's DB clock is UTC+8.

   The kicked job is processed first. Fresh jobs are left to their own kick, so parallel saves don't race for each other's claims; a twin claim crashes its run. The list's poll is unchanged.
2. **In-run retries.** The first 3 jobs of a run get two more passes (`code_node_JsJ91wA5`).
   - A pass is processed only for a job that a lock conflict left waiting: COMMITTING_GD with GD_INVENTORY_IN_PROGRESS or GD_INVENTORY_RETRYABLE_REJECTION.
   - Passes run within a 45 s retry budget; other jobs keep the 20 s budget (`code_node_Qo8Suk1M`).
   - Before a pass, `sql_node_WKwait` sleeps until that job's next attempt, at most 8 s away. A wait is 2 s, and the retries back off 2, 4 and 8 s.
3. **The answer** (`code_node_LdCyuBWM`) lists each job once and reports the kicked job.
4. **Sweep safeguards** (`patch_worker_sweep_safeguards.py`):
   - **Random order.** A save's kick takes the stale jobs in random order, with its own job still first. The GD list's poll keeps oldest-first. This is because the W0 claim is a unique insert, and a twin claim crashes its run. The platform offers no non-fatal claim: sql-nodes are read-only, and a caught error still answers 400 and would let the run write a lease it does not own. So the race can only be made rare: two simultaneous saves now seldom reach for the same backlog job.
   - **Attempt limit.** The sweep skips jobs that have used 3 or more attempts. A job that keeps failing is left to its own kick and the list, so it no longer stops every save's sweep (the loop stops at the first failed node).

   Live on dev as worker v15 (13:25). A kick for one job processed it, then swept a job left un-kicked for 12 s, both COMPLETED in one 16 s run (GD/20261023/613 and 614), and the run reported the kicked job.

**No limit concern:** the worker's compiled chain is 4,901 of 65,535 bytes.

## Paste

Paste `GD_ASYNC_WORKER.json`, `GD_BULK_COMMIT.json` and `GD_JOB_RECONCILE.json` into their designers and publish, in the same session. They need engine v12, which is live on prod since 12:40.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json"   # IDENTICAL
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"    # IDENTICAL
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_JOB_RECONCILE.json"  # IDENTICAL
```

## Undo

The `RESTORE_*` files are what prod runs now: GD_ASYNC_WORKER v11, GD_BULK_COMMIT v19 and GD_JOB_RECONCILE v6.

## Source and tests

- **Patch:** `scratchpad/gdc/gdcreate/patch_worker_sweep_retry.py`.
- **Offline tests:** `test/test_worker_sweep_retry.js`, 17 cases on the JSON's own code: plan passes, pick budgets and skips, the pass wait slot, the answer, the poll.
- **Lint:** one new informational finding, UNUSED output of the sleep node.
- **Dev:** v13, published 10-23 13:12, after a v12 at 13:10 that missed never-started jobs.
- **Live tests** (`scratchpad/gdc/gdcreate/deploy_worker_sweep/live_test3.py` and `live_test3a_v13.py`):
  - **A, in-run retry, run twice:** the item lock was held by hand, then a save was kicked. The job waited at 4.5 s, and the lock was released then. The *same* run recovered and completed the job, with no second kick: GD/20261023/609 in 15.4 s (v12) and GD/20261023/611 in 14.7 s (v13). Lock rows were restored.
  - **B, stale sweep:** a save was left un-kicked; a kick for another, finished job swept it 9 s later (GD/20261023/610, v13).

