# A crashed stock call no longer parks a GD for 30 minutes; the SO list recovers lost convert answers (2026-10-23)

| # | Prod target | File here | Base on prod |
|---|---|---|---|
| 1 | **GD_SO_CONVERT_CHECK** (2112084100104495105) | `GD_SO_CONVERT_CHECK.json` | v7, identical to the repo before this change |
| 2 | **SO list page**, event script `func_handleConvertGD` (page 1901872125787099137) | `func_handleConvertGD.js`, or the whole page `SO_list_page.prod_v214_recover.json` | v214; its handler is the one this was built on |
| 3 | **GD_BULK_COMMIT** (2104840402446245890) | `GD_BULK_COMMIT.json` | v20, identical to dev v20 |

Paste 1 before 2: the new SO list asks the check for something v7 does not answer. 3 is independent of both.

## 1 + 2: the SO list recovers a convert answer it lost

**What happened (LSH, 13:59).** eve converted 4 sales orders. SO_AUTO_GD converted all 4 (GD-2610-1104 to 1107), but the run took 90 s: two of the sales orders have a non-stock line, so they went through the slow classic save (63 s and 25 s). The list's request gave up first, so the list said "No answer from the server" for all 4.

**Now:**
- When a batch's answer is lost, the list shows "the server is still working (N s)…". It asks GD_SO_CONVERT_CHECK every 5 s, for at most 5 minutes, for that batch's SO_AUTO_GD run.
- The run's record appears when the run ends, and it holds the run's own answer. The list then shows the real summary: created, not converted with reasons, and being created in the background. It also starts and follows the queued V2 jobs, as when the answer arrives normally.
- If the run itself crashed, each sales order says "The conversion stopped with an error on the server: … Check whether it already has a goods delivery before converting it again."
- If no record appears within the 5 minutes, or the check fails 3 times running, the list falls back to today's "No answer" message.

**The check (v8).**
- Two new optional inputs: `run_so_ids` (the batch's sales orders) and `run_since_s` (seconds since the batch was sent, 1 to 3600).
- A third parallel read takes the newest SO_AUTO_GD run record of the tenant that has exactly those sales orders and started in that window. It uses the run table's (workflow, tenant, deleted, create_time) index; on dev it touched 2 rows.
- It answers `run_json`: run id, status, the run's own answer, and its error. `run_json` is "null" while the run is still going.
- The so_ids / job_ids answers are unchanged.

**Tests.**
- **Offline:**
  - `scratchpad/gdc/gdcreate/test/test_convert_check_run.js`: 13 cases on the check's code;
  - `scratchpad/soautogd/test_client.js`: 10 cases, 5 of them new for lost answers (recovered, run failed, no record, check down, normal answer);
  - `scratchpad/gdc/gdcreate/test/test_convert_handler.js`: 5 cases.
- **Dev:** check v8 and SO list page v535 were published 14:31.
  - The platform numbered the page v535 because of older numbering gaps; v538 is now history.
  - Live test (`deploy_convert_recover/live_test.py`), with no business writes: SO_AUTO_GD ran on two fully planned test SOs and refused both ("Nothing left to deliver"). The check answered null before the run and that exact answer after it.

## 3: a failed stock call is retried at once instead of holding the GD 30 minutes

**What happened (Kenhin, 13:02).**
1. Kenhin saved 11 GDs within 5 s. Two engine runs created the same new lock row 32 ms apart, and the second one's insert failed on the duplicate.
2. INVENTORY_APPLY_OPERATION, GD_BULK_COMMIT and the worker all crashed. The crash wrote nothing.
3. But the job stayed under COMMIT's 30-minute lease. Every kick and every list poll was turned away, and GD/20261023/2021 completed at 13:35.

Every worker crash on prod since 10-16 (13, all on 10-23, at LSH and Kenhin) stopped at this same call.

**Now:**
- COMMIT runs the INVENTORY_APPLY_OPERATION call inside a try-catch. When the call fails, COMMIT decides from the operation row:
  - **No operation recorded:** the engine stopped before it started; nothing ran. This is a counted retry, the same as a lock conflict:
    - the job stays COMMITTING_GD with "Stock is busy; retrying (INVENTORY_CALL_FAILED)";
    - the lease is released and the attempt count goes up;
    - the next attempt is 2 s later (backoff 2, 4, 8, 16, 30, 30 s) under a new operation id;
    - after 6 failures the job fails cleanly (GD_TRANSIENT_RETRIES_EXHAUSTED) and its hidden rows are removed.
  - **An operation recorded:** decided as before. DONE carries on; a live one makes the job wait (without holding the job's lease) until the engine's own 10-minute lease ends; review stays review.
- The worker still sees the COMMIT call fail, because a caught error still marks the run. But the job row is written first, so the next kick (the form follows every few seconds, and other saves sweep it) resumes it in seconds.

**Tests.**
- **Offline:** `scratchpad/gdc/gdcreate/test/test_commit_catch.js`, 13 cases. They cover the try-catch shape, the normalizer, and every decision: retry 1, retry 4, used up, live operation, DONE, expired before mutation, mid-mutation, and the unchanged paths.
- **Lint:** only 3 informational UNUSED notes on the try-catch wrapper.
- **Dev:** v21, published 14:39. Live test (`deploy_commit_catch/live_test.py`):
  1. The engine's lock seed was made to fail before it records its operation: the free ITEM lock row the test GD needs was soft-deleted, which the engine refuses by throwing. That is the same place Kenhin's run failed.
  2. A 1-unit GD V2 save was kicked. The worker answered 400 and COMMIT's run kept the caught error. The job was left COMMITTING_GD, retry 1, lease released, P3 moved to operation `…|2`, and no operation row existed.
  3. The row was restored and kicked again: COMPLETED in 6.8 s, operation DONE OK. GD/20261023/615 is Created, with 1 reservation and 2 movements. The lock row is back to free.

**No limit concern:** COMMIT's compiled chain grows by about 150 bytes (from 46,947 of 65,535).

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json"   # IDENTICAL (v8)
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"        # IDENTICAL
```

For the page, compare the enabled prod page's `func_handleConvertGD` with `func_handleConvertGD.js`.

## Undo

The `RESTORE_*` files are what prod runs now: GD_SO_CONVERT_CHECK v7, GD_BULK_COMMIT v20, and SO list page v214 (whole page, or its old handler `RESTORE_func_handleConvertGD.js`).

## Source

- **Check:** `scratchpad/gdc/gdcreate/patch_convert_check_run.py`.
- **COMMIT:** `scratchpad/gdc/gdcreate/patch_commit_catch_engine_call.py`.
- **List handler:** `Goods Delivery/GDhandleConvertSOtoGD.js`.

## Prod: DONE 2026-10-23 14:45-14:48

- **GD_SO_CONVERT_CHECK:** v8 (14:45:45), IDENTICAL.
- **SO list page:** v261 (14:47:06).
  - `func_handleConvertGD` equals `func_handleConvertGD.js`, and no other handler changed.
  - The designer dropped the empty `onFormChange` placeholder (type rule, no code).
- **GD_BULK_COMMIT:** v21 (14:47:58).
  - Every node's code is identical to the file.
  - The designer's paste dropped the try-catch blocks' `key` ("try" / "catch") and the try block's empty `data`, so `wf --prod deployed` says DIFFERS. That is expected.
  - The compiled chain is identical to dev's: 47,057 bytes, with `CATCH(THEN(try_catch_P3invCal, workflow_node_q2vFSyDT)).DO(THEN(code_node_P3crash0))`.
