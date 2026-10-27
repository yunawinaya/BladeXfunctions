# Plan: a lost worker claim ends quietly (no red "CLAIM GATE" toast)

**Status:** plan only, not built (10-27). It applies to all five V2 workers: GD_ASYNC_WORKER (create), GD_COMPLETE_WORKER,
GD_EDIT_WORKER, GD_CANCEL_WORKER and GD_REVERT_WORKER.

## The problem
**Today's claim gate:**
- A run claims a job by inserting `gd_publish_step` `W0_CLAIM_<row_version>`, which has a unique key per tenant / job / step.
- When two runs pass the fresh read at the same moment, the second insert fails with "Duplicate entry".
- That run stops before writing anything, which is correct.

**What the platform makes of it:**
- The run is reported failed (HTTP 400), so the page that started it shows a red toast (LSH 10-27: 34 bursts in 40 min).
- prod_health counts it as a crash.

**Why the obvious fixes don't work here:**
| Idea | Why not |
|---|---|
| try/catch around the insert | a caught error still marks the run failed: HTTP 400, toast ([[project-lowcode-trycatch-semantics]]) |
| claim in a child workflow | a child's failure fails the caller ([[project-lowcode-child-crash-fails-parent]]) |
| atomic UPDATE (compare-and-set) in SQL | sql-nodes are SELECT-only |
| conditional update-node | its WHERE is not enforced, and it reports nothing |
| atomic-count token as the claim | it blocks until the holder's top-level run ends, with no timeout. A second TAKE beside the engine's tokens risks deadlock ([[project-lowcode-atomiccount-semantics]]) |

So the unique insert stays: it is the only airtight mutex. The aim is that two runs (almost) never reach it together.

## Phase 1: stop the clients colliding with themselves (done 10-27)
- **GD list:** drains one run at a time per worker per window (prod v193). Before, the old chain did not chain at all.
- **SO list:** re-kicks start one run, for the oldest waiting job, not one per waiting job (dev v539; prod paste pending).
- **Picking (42):** the screens poll STATUS and start each queued completion once. An open Picking list also sweeps
  GD_COMPLETE_WORKER every 60 s.

What can still collide: two different browsers or pages kicking the same worker in the same second.

## Phase 2: measure (a few working days after the Phase 1 pastes)
- **The count:** the claim-gate failures per tenant per day (`su_code_workflow_inst`, the worker ids, status Fail,
  `current_node_id` = the claim add-node), against 10-27.
- **The decision:** if the toasts are rare, stop here. Otherwise build Phase 3.

## Phase 3: a quiet bid before the claim (only if Phase 2 says so)
In each worker's Pick step, before the `W0_CLAIM` insert:
1. **Bid:** insert the run's own row `W0_BID_<row_version>_<nonce>`. The name is unique per run, so it never collides.
2. **Wait:** about 1.5 s, using `SELECT SLEEP(1.5)` in a sql-node, which is allowed.
3. **Read the bids:** read the job's `W0_BID_<row_version>_*` rows.
   - The winner is the earliest by `started_at` (DB clock, from the fresh read), with ties broken by id.
   - A loser returns quietly: "claimed by another run", nothing written, no error.
4. **Claim:** only the winner inserts `W0_CLAIM_<row_version>`. The unique key stays as the airtight backstop, so a run
   delayed past the wait can still only fail, never double-process.

**And in the fresh read:** treat a live BID (under 10 s old, another run's) like a live claim, and skip the job.

**Cost:** about 1.5 s per claimed job, against job runs of 10-20 s, and one small insert per bid. BID rows can be
cleared with the job's other step rows.

**Risks to test:**
- runs on two app servers whose clocks differ (the ordering uses DB time, so it should hold);
- a bidder that dies between its bid and its read (the next run sees a stale bid older than 10 s and ignores it);
- the 2k-line jobs (the wait is per job, not per line).

**Test on dev before any paste:**
- 10 parallel kicks of one worker on a queue of 20 jobs. Expect 0 failed runs, every job processed exactly once, and
  W0_CLAIM rows only from winners.
- The same at real LSH size.
