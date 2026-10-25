# GD background workers: one kick must drain the work (LSH, 2026-10-25)

No scheduler runs the GD workers (by design: no Quartz). A run starts only when a browser kicks it: a bulk action's follow
loop while its page is open, or someone opening the GD list or a GD. Two workers stopped too early for LSH's volume.

## 1. GD_COMPLETE_WORKER (2110182645714518018)

**Problem.** Each run took the 5 oldest due jobs, but started no new job after 20 s. An LSH completion takes about 25-30 s, so
each run finished ONE GD, and the rest waited for the next kick:
- early batch: GD-2610-1302 / 1303 / 1304 waited about 51 minutes;
- 12:06 batch: GD-2610-1320 to 1327 were still queued at 12:30.

**Fix.**
- Budget 240 s, so a run finishes every job it selects (a started job is never cut).
- The poll takes 10 jobs (was 5), so one kick completes about 8 LSH GDs.
- Leases, claim gates and retries are unchanged.

Paste `GD_COMPLETE_WORKER.prod_v5_budget240_poll10.json` into **GD_COMPLETE_WORKER** (2110182645714518018), then enable it.
It is prod v5 with 5 budget constants, the poll's LIMIT, its title and the input description changed. It is node for node the
same as the repo file. Look-alikes to avoid: GD_COMPLETE_SUBMIT / PREPARE / COMMIT, GD_CANCEL_WORKER.

## 2. GD_ASYNC_WORKER (2104840667119411201): GD creation

**Problem.** GD-2610-1324 took 13 minutes:
- The SO list started 10 conversions in parallel. They met LOCK_CONFLICT on the same stock and retried with backoff (2-30 s).
- The run itself retried at most twice, sleeping at most 8 s, within 45 s.
- The SO list re-kicked for only 2 minutes. The retry due at 11:42:49 waited until 11:52:51.

**Fix.** A lock conflict's retries finish inside the run that met it:
- six retry passes (was two) within 240 s (was 45);
- each pass sleeps until the job's next attempt when it is at most 30 s away (was 8 s), which covers every backoff step;
- a list sweep starts new jobs for 240 s (was 20).

Attempt counting, backoff and max_retries 6 are unchanged (GD_BULK_COMMIT decides them). A sleep holds one DB connection; prod
peaks at 175 of 2,607.

Paste `GD_ASYNC_WORKER.prod_v12_lsh_waits.json` into **GD_ASYNC_WORKER** (2104840667119411201), then enable it.
It is prod v12 plus `scratchpad/gdc/gdcreate/patch_worker_lsh_waits.py` (3 nodes). It is node for node the same as the repo file.
Test: `scratchpad/gdc/gdcreate/test/test_worker_sweep_retry.js` passes on it. Look-alikes to avoid: GD_ASYNC_SUBMIT,
GD_ASYNC_WORKER's callees GD_BULK_PREPARE / GD_BULK_COMMIT.

`*_live.json` files are what prod runs now. They are kept only to reverse the change.

## After pasting

1. Open the LSH GD list once. Its mount kicks the completion worker, which now finishes GD-2610-1320 to 1327 in one or two runs.
2. Check: `.dbtools/wf --prod deployed "Goods Delivery/CompleteV2/GD_COMPLETE_WORKER.json"` and the same for
   `Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json`. Both must say IDENTICAL.
