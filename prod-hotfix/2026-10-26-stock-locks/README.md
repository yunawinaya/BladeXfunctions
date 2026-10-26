# 2026-10-26 Stock locks: one ordered TAKE, one stock call per GD worker run, verify at the stored scale

> **INVENTORY_APPLY_OPERATION.json here is WITHDRAWN - never paste it again.**
> - Pasted 11:06:39 as prod v13, then rolled back to v12 (the user re-enabled v12; file ROLLBACK_INVENTORY_APPLY_OPERATION_prod_v12.json).
> - It took every key in one call but still gave keys back in parallel lanes, and a lane cannot release keys the main call took.
> - Every operation with more than 25 keys froze at give-back until the 20-min limit: GUB GD-26/10/0544, PACK-2610-1434, PACK-2610-1462.
> - Their keys came back by themselves when the runs ended (11:30:36, 11:32:58, ~11:39). No SQL was needed; repair_frozen_give.sql was not run.
> - The other files are live and fine: INVENTORY_OPERATION_RECONCILE v12, GD_ASYNC_WORKER v17.
> - A future engine fix must make the give-back match the take, and be tested on dev with more than 25 keys first.

Three fixes from the day's open items, one paste. This folder replaces `../2026-10-26-engine-precision-worker-herd/`, which was
never pasted.

## Paste (prod)
| Workflow | prod id | live now | file | differs only in |
|---|---|---|---|---|
| INVENTORY_APPLY_OPERATION | 2105133980371554305 | v12 | INVENTORY_APPLY_OPERATION.json | sql_node_e7OzTOyD, code_node_8rCPo75P, code_node_FyT3zuFi, code_node_p0sOD8ej, code_node_Pf6NFe7B, code_node_ncZJyNmS, code_node_LNtake |
| INVENTORY_OPERATION_RECONCILE | 2105134048113758209 | v11 | INVENTORY_OPERATION_RECONCILE.json | code_node_mDGats0w |
| GD_ASYNC_WORKER | 2104840667119411201 | v16 | GD_ASYNC_WORKER.json | sql_node_oAHg7l6A, sql_node_WKwait, code_node_Qo8Suk1M, code_node_JsJ91wA5, code_node_PKdec001, set_cache_node_dv5GX4FO |

- **Order:** any. If one at a time: INVENTORY_APPLY_OPERATION first (the freeze and the false reviews), then GD_ASYNC_WORKER.
- **No node is added.** The engine's chain expression (su_code_workflow.el_expression, 65,209 of 65,535 bytes) is unchanged
  on dev after the publish.
- **After the paste:** `.dbtools/wf --prod deployed "prod-hotfix/2026-10-26-stock-locks/<file>"` must say IDENTICAL for each.
- **Paste with it:** `../2026-10-26-gde-worker-one-job/` (GD_EDIT_WORKER, the Edit & Picking session's), at most one job
  per run under the same rule. It has its own README.

## Why: the platform holds a stock key until the whole top-level run ends
INVENTORY_LOCK_TOKENS takes a key with the platform's atomic-count node. Its distributed lock has no wait timeout, and it is held
until the top-level run ends (the worker run), not when the engine call ends. Prod timings:
- **Packing PKG|2114544577384943617|3:** its TAKE waited 99.7 s. It got through 1.8 s after GD_COMPLETE_WORKER
  2114544729973723137 ended, and 15 s after that worker's engine run had ended.
- **07:28:58:** a 59.5 s TAKE got through 1 s after a 243 s GD worker tick ended.
- **07:31-07:51 freeze:** GD|2114497026472415234|11 took 25 keys, then 8 parallel lanes. 7 lanes finished in 1 s, yet 4 other
  GDs stayed blocked on those keys. One lane waited for one of those GDs. All were released only when the platform killed the
  parent at its 20-min limit; 81 keys were stranded.
- **The tick involved** (WRK|aef9c5cf...) had finished another GD minutes earlier and still held its keys.
- **Cost today at LSH:** 82 TAKEs over 30 s and 35 over 2 min. Before today it was 12-19 a day over 30 s, and nothing over
  5 min.

## 1. INVENTORY_APPLY_OPERATION takes every key in one call, in lock order
- **Change:** code_node_LNtake puts all keys in the first TAKE call. The 9 parallel lanes (since 10-22) stay empty, the path
  every operation with 25 keys or fewer already took.
- **Why:** lanes break the lock order. A lane waiting on one key while the other lanes hold later keys deadlocks with any
  TAKE in sorted order.
- **Cost:** none at LSH sizes (a 72-key TAKE runs in about 1-2 s sequentially). A 2,000-line GD (about 4,000 keys) takes
  longer, but cannot deadlock.

## 2. GD_ASYNC_WORKER: one stock call per run
- **After a commit call:** an iteration that called GD_BULK_COMMIT sets the next loop index past the plan (code_node_PKdec001,
  set_cache_node_dv5GX4FO). The run takes no further job and never sleeps on the keys it touched.
- **No retry passes.** The 10-23 passes slept up to 30 s, 6 times, in a run that had just touched the keys; that is what held
  them through the morning. A waiting job is retried by the next kick:
  - every job has its own job_id kick (GD form; the SO list re-kicks each queued job every 15 s for 2 min);
  - the GD list ticks every 2 min.
- **First-pass hold-off removed.** The 10-26 claim-herd fix waited 10 s for a sleeping retrier; with no retrier, that wait
  would only delay the job.
- **Herd guards kept, dormant.** The last-claimer guards (tick read `last_claim_owner`, WKwait, Pick) stay in place in case
  retry passes return. The herd itself came from the passes: 161 runs died on `Duplicate entry ... W0_CLAIM_<n>` between 06:51
  and 08:31.

## 3. The engine verifies stored decimals at the scale the platform stores them
- **Cause.** The platform rounds stock decimals on write to the tenant's number rule (su_code_num_precision):
  - "Inventory Price": movement unit_price / total_price;
  - "Inventory Qty": the movement and balance quantities;
  - all 80 prod tenants: 4 / 3 decimals, half up.
- **Effect.** The engine planned at 8 decimals and compared exactly. A FIFO price with more decimals sent a correct GD to review
  (GUB GD-26/10/0528: planned 99.93685714 / 6995.5799998, stored 99.9369 / 6995.58).
- **Changes.**
  - The balance read under lock returns the tenant's rules (`num_rules`, declared). It reads them the way INVENTORY_BULK_APPLY
    does: group rules plus per-column rules.
  - Revalidate keeps them in plan.scale and in the stored mutation plan.
  - The 4 checks and the reconcile accept the planned value, or that value rounded on the rule's scale: half up within half a
    step; rules 2 / 3 within one step.
  - A column rule wins over its group rule; no rule, or raw storage, compares exactly. Written values are unchanged.

## Tests
- `scratchpad/gdc/gdcreate/test/test_one_stock_call.js`: 6 pass (LNtake). `test_worker_sweep_retry.js`: all pass, including the
  "one call" cases:
  - a committed job, and a commit that left the job waiting -> next index 9999;
  - no commit -> Pick's next index;
  - past the plan -> SKIP and no sleep;
  - the cache wiring.
- `test_engine_precision.js`: 190 pass. `replay_engine_precision.js`: 16 pass on the real GUB run.
  `test_max_retries_20.js`: pass. Every new case failed before its patch.
- **Prod, read-only:** the new SQL reads ran against real GUB / LSH rows; the claim lookup uses the Job Step index.
- **Lint:** no new findings.
- **Dev:** INVENTORY_APPLY_OPERATION v15, INVENTORY_OPERATION_RECONCILE v13 and GD_ASYNC_WORKER v21, identical to these files.
  - **10:23 run (precision):** GD/20261026/625 was created; the engine run read `1:Inventory Price:::4:1:0;1:Inventory
    Qty:::3:1:0` from the platform and all checks answered OK.
  - **10:50 run (one call):**
    1. GD/20261026/625 was cancelled through GD Cancel V2;
    2. SO_AUTO_GD SO/20260720-062 gave job 2114550171507675138;
    3. the worker took it to COMPLETED: GD/20261026/626 Created;
    4. engine run 2114550186200322049 made one TAKE and one GIVE call, with the lanes empty;
    5. the worker planned 1 item and no retry passes, and after the commit stored next index 9999.

Scripts: `scratchpad/gdc/gdcreate/patch_engine_precision.py`, `patch_worker_claim_herd.py`, `patch_one_stock_call.py`.

**Next, not in this paste:** the same one-stock-call rule for GD_COMPLETE_WORKER and GD_CANCEL_WORKER (GD session), and the
Packing / Picking / Edit workers (their owners have the root cause).
