# GD Completed & Created V2: LSH readiness items

Owner session: "GD Completed & Created V2".

Owned workflows:
- GD_ASYNC_* (create): GD_ASYNC_SUBMIT, GD_ASYNC_WORKER, GD_BULK_PREPARE, GD_BULK_COMMIT;
- GD_COMPLETE_*;
- GD_CANCEL_*;
- SO→GD convert;
- the GD list bulk Complete / Cancel clients and gdc_list_mounted.js.

## User actions for prod, in order of importance for 10-26

| # | What | Files | Why |
|---|---|---|---|
| 1 | Paste GD_COMPLETE_WORKER (2110182645714518018) | `prod-hotfix/2026-10-25-lsh-gd-worker-budget/GD_COMPLETE_WORKER.prod_v5_budget240_poll10.json` | One kick finishes about 8 LSH completions instead of 1. GD-2610-1320 to 1327 are still queued. |
| 2 | Paste GD_ASYNC_WORKER (2104840667119411201) | same folder, `GD_ASYNC_WORKER.prod_v12_lsh_waits.json` | SO→GD under contention: lock-conflict retries finish in the run instead of waiting minutes for a click. |
| 3 | Paste GD_CANCEL_COMMIT, GD_CANCEL_WORKER, GD_CANCEL_PREPARE, GD_CANCEL_SUBMIT (ids in the folder README), run `resume_3_cancels.sql`, open the GD list | `prod-hotfix/2026-10-25-lsh-gd-cancel-shared-picking/` | Cancels of GDs sharing a Picking (dev live test passed); recovers GD-2610-1305 / 1308 / 1310; cancel reads stop growing with the square of LSH's Packing rows. |

| 4 | Paste GD_COMPLETE_SUBMIT (2110182609618337794) | `prod-hotfix/2026-10-25-gd-complete-form-emptyref/GD_COMPLETE_SUBMIT.prod_v11_emptyref.json` | Form completions stop falling back to the classic (lockless) save on an empty attachment list (index item 10). **DONE**: prod v12 15:21:05, IDENTICAL. |
| 6 | Paste the GD list page (1902688873696313346) | `prod-hotfix/2026-10-25-gd-list-worker-kicks/GDlistPage.prod_v401_worker_kicks.json` | Queued completions keep moving after the page closes: one worker run per queued GD, plus a 2-minute re-kick while any GD list is open (index item 11, BA point 1). **DONE**: prod 19:52:24, identical to the file. |
| 5 | Run `repair.sql`, then Complete GD-2610-1245 | `prod-hotfix/2026-10-25-lsh-gd1245-balance/` | **DONE** 14:40 / 14:53 (index item 9). |

Items 1-3: **DONE** (pasted 14:17-14:25, all IDENTICAL; 3 held cancels COMPLETED 14:31).

After each paste: `.dbtools/wf --prod deployed <repo file>` must say IDENTICAL (on 10-24 a paste landed in a look-alike).

## Dev status (10-25)

- **GD_COMPLETE_WORKER v7:** budget 240 s, poll 10. Smoke OK.
- **GD_ASYNC_WORKER v16:** 6 retry passes, sleeps up to 30 s, 240 s budget. `test_worker_sweep_retry.js` 20/20; smoke OK.
- **GD_CANCEL_COMMIT v7 / GD_CANCEL_WORKER v5:**
  - X5 renames per token on shared Picking headers; X4P decides a header on its rows as they are now; X4P / X5 wait while a
    Picking is held (item 2b).
  - The X4P query ran read-only on prod.
  - Live test 13:23 (000000 PI-20261019-0361, GD/20261019/599 + 600 cancelled together): both COMPLETED, no retry, both
    numbers renamed, all 4 rows Cancelled. **The header ended Completed:** 600's X4P closed it Completed while 599's rows
    were still picked; 599's X4P then cancelled its rows but skipped the Completed header.
  - Fix, **GD_CANCEL_COMMIT v8** (13:36): X4P skips a Cancelled header, and a Completed one only when this GD has no rows on
    it; once every row is Cancelled the header becomes Cancelled + "-Cancelled". `test_shared_picking.js` 26/26 (the live
    sequence added), commit simulation all scenarios, PREPARE / SUBMIT simulation 21/21, lint unchanged.
  - The second live test (496474 PI-20261021-0104, GD/20261021/112 picked + 113 open) first crashed in PREPARE: its Picking
    read hit the 30 s statement limit. Cause: `IN (… UNION …)` id subqueries run once per outer row, and the Packing child
    tables have no packing_id index, so three cancel reads grow with the square of the tenant's rows (prod: LSH's Packing read
    2.5 s alone, 7 s with 10 cancels). **GD_CANCEL_PREPARE v4 / GD_CANCEL_SUBMIT v4** (14:01) read each id set once as a
    derived table: identical rows on 8 LSH GDs (prod, read-only) and 3 dev GDs; 2.5 s → 0.4 s, 1.7 s → 0.4 s, dev > 30 s →
    0.3 s.
  - Resumed at 14:02: both COMPLETED; header Cancelled with one suffix; delivery list both renamed; 4 rows and 5 reservations
    Cancelled. This run took the harmless order (112 first), so the Completed → Cancelled header path is proven offline.
  - Paste files refreshed (4 workflows, each prod's live version plus only its changed nodes).

## Watch tomorrow

- `python3 scratchpad/prod_health.py --tenant 128671`: JOBS (queued and untouched 15+ min; REQUIRES_REVIEW), CRASHES, GD-STOCK.
- Expected noise: a twin claim's duplicate `W0_CLAIM_<n>` insert can crash one GD_ASYNC_WORKER run. That is the claim gate
  rejecting a second worker, not a double stock effect.
- Under heavy volume, many LOCK_CONFLICT retries in GD_BULK_COMMIT results are expected. A job FAILED with
  GD_TRANSIENT_RETRIES_EXHAUSTED (6 retries used) needs a resubmit. Count them if they appear.
