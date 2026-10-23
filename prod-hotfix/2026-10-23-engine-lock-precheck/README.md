# A taken lock waits and retries in seconds instead of crashing (2026-10-23, LSH 128671 incident)

| # | Prod workflow | File here | Base on prod |
|---|---|---|---|
| 1 | **INVENTORY_APPLY_OPERATION** (2105133980371554305) | `INVENTORY_APPLY_OPERATION.json` | v11, identical to dev v11 (checked 10-23) |
| 2 | **GD_ASYNC_WORKER** (2104840667119411201) | `GD_ASYNC_WORKER.json` | v10, identical to dev v10 (checked 10-23) |

Paste both in the same session.

**2. GD_ASYNC_WORKER** treated a COMMITTING_GD job as not due while any inventory operation of the job held a live lease, REJECTED included. The engine's recovery leaves a fresh 10-minute lease on the operation it rejects, so the retry waited about 10 minutes.

- **The change:** REJECTED is removed from that status list, in the poll and in the tick read. DONE and REQUIRES_REVIEW stay.
- **Why it is safe:** the rejected operation's run has returned before the job is free again. Any lock it might still own makes the new operation wait (engine fix 1), never crash.
- **Why not in the engine:** the engine itself cannot grow. Dev's `su_code_workflow.el_expression` is TEXT, at most 65,535 bytes, and the engine's v12 chain already uses 65,209 of them. A v13 with the expiry inside the engine failed to publish: "Data too long for column 'el_expression'". The failed attempt left v13 designing and draft history rows on dev; they are harmless.

## What happened

Five LSH GD V2 creates were stuck in Processing from 11:35: GD-2610-1027, 1028, 1040, 1042 and 1052. Several saves ran at once on the same batches.

1. The engine's lock precheck (P7, `code_node_J6YxjhQw`) threw `INV_LOCK_TAKEN_PRECHECK` when a key was already taken.
2. A crashed child workflow crashes its caller, so GD_BULK_COMMIT P3 and the worker died with it.
3. Each job stayed under the dead worker's 30-minute lease.
4. The next kick then recovered the stale LOCKING operation as REJECTED / LOCK_CONFLICT.
5. The worker waited another 10 minutes, the recovered operation's lease, before retrying.

## The fix

The precheck answers busy instead of throwing. A new branch (`if_LKbusy00`), placed before any claim:

- sets this run's operation lease to the DB time just read, so it is expired;
- returns `OPERATION_IN_PROGRESS`.

GD_BULK_COMMIT maps that answer to WAIT: the job is released and due again in seconds. Its next call finds the LOCKING operation stale, the engine's existing recovery rejects it as LOCK_CONFLICT, and the caller retries with a new operation, as before. PACKING_BULK_COMMIT maps `OPERATION_IN_PROGRESS` to WAIT too.

Nothing is claimed on this path, and the lease is expired only when it is this run's. The gate protocol is unchanged.

**What changes:** no crash, and no 30-minute lease. The 10-minute wait on the recovered operation's lease is removed by change 2.

**Not covered:** a key taken between the precheck and the claim still fails at the lock verify (P12). That window is short.

## Paste

Paste `INVENTORY_APPLY_OPERATION.json` and `GD_ASYNC_WORKER.json` into their designers and publish, in the same session. They don't depend on the other 10-23 pastes.

## Check after pasting

```
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/INVENTORY_APPLY_OPERATION.json"   # IDENTICAL
.dbtools/wf --prod deployed "Goods Delivery/AsyncV2/GD_ASYNC_WORKER.json"             # IDENTICAL
```

## Undo

`RESTORE_INVENTORY_APPLY_OPERATION.json` is prod v11 and `RESTORE_GD_ASYNC_WORKER.json` is prod v10, what prod runs now.

## Source and tests

- **Patch:** `scratchpad/gdc/gdcreate/patch_engine_precheck_wait.py`.
- **Offline tests:** `scratchpad/gdc/gdcreate/test/test_engine_precheck_wait.js`, 12 cases run on the JSON's own code.
- **Lint:** unchanged (45 findings before and after).
- **Dev:** v12, published 10-23 12:21.
- **Live test** (`scratchpad/gdc/gdcreate/deploy_engine_wait/live_test.py`, user's yes):
  - one ITEM lock row was held by hand, and a GD V2 save on that item and bin went to WAIT, with no crash and the worker answering 200;
  - the lock row was restored exactly;
  - the next kick recovered the operation, and the job went to GD_INVENTORY_RETRYABLE_REJECTION;
  - about 10 minutes later, after the recovered operation's lease ran out, it completed (GD/20261023/607).
- **Worker:** v11 on dev, published 10-23 12:33. The patch is `scratchpad/gdc/gdcreate/patch_worker_rejected_not_live.py`. Lint is unchanged (19 findings), and the poll SQL ran read-only on dev.
- **Second live test** (`scratchpad/gdc/gdcreate/deploy_worker_rejected/live_test2.py`), the same steps with both fixes:
  - held → WAIT;
  - released → recovered;
  - 3 s later a new operation was DONE, and the job COMPLETED (GD/20261023/608).
  - The time from the release to the created GD was **13 s**.
