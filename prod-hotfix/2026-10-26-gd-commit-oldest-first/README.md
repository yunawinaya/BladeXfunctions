# 2026-10-26 08:15 GD_BULK_COMMIT: oldest waiting delivery goes first + P3 retry limit 200

Paste `GD_BULK_COMMIT.json` into **GD_BULK_COMMIT (2104840402446245890)**. It replaces v25, the same-op retry, and keeps it.

## Why
Old GDs (GD-2610-1470 / 1478 / 1479 / 1494 / 1506 / 1508 / 1520 / 1536, created 07:19-07:54) were starving with nothing
frozen.
- Each needs all its keys free at one moment and got a try only every 1-2 minutes.
- Newer GDs started stock calls at once and kept taking one or two of their keys.
- The oldest were at retry 47-53 of 60 at 08:11.

## Changes (3 nodes; nothing else differs from prod v25)
1. **sql_node_kY5OLfvj (P3 facts)** also returns `older_waiting`: the oldest older CREATE_GD job of the organization that
   - is COMMITTING_GD with GD_INVENTORY_RETRYABLE_REJECTION / IN_PROGRESS;
   - was touched in the last 3 minutes (a job nobody drives blocks no one);
   - has a staged line with the same material + location.
2. **code_node_a4HIjyaU (before-call):** before a NEW stock call, if `older_waiting` is set, it waits 30 s, uncounted,
   naming that GD. Recovering this job's own stale operation is never delayed.
3. **P3 `GDC.retry.max_retries` 60 -> 200** in code_node_a4HIjyaU and code_node_7NQFbpmU, so no waiting GD fails before its
   turn. The worker and reconcile keep 60, which they use only for dead runs.

## Tested
- `test_commit_fifo.js`: 5 pass. The first case fails on prod v25, so the test sees the change.
- `test_commit_same_op.js`: 10 pass. `test_max_retries_20.js ... 200` passes.
- The new SQL ran read-only on prod with live jobs: a newer job got `GD-2610-1479`, the oldest overlapping waiter; 0.4-0.5 s.
- Dev GD_BULK_COMMIT v26 published. A real V2 conversion completed: GD/20261026/620, 12 steps.
- Lint unchanged (16 old notes).

Scripts: `scratchpad/gdc/gdcreate/patch_commit_fifo.py` and an inline 60 -> 200 edit (same pattern as patch_max_retries_60.py).
