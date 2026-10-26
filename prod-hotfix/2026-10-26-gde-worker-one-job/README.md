# GD_EDIT_WORKER: at most one job per run (stock-lock rule), 2026-10-26

**Paste into: GD_EDIT_WORKER (id 2110618789356687361).** Not GD_EDIT_COMMIT / GD_EDIT_SUBMIT, and not GD_COMPLETE_WORKER /
GD_REVERT_WORKER. Prod live: v8 (2026-10-22 15:23:09), byte-identical to dev v8. Paste with the GD session's stock-lock
batch (`../2026-10-26-stock-locks/`) or later: the user's call.

## Why

- **The constraint (found by the GD session today, after the LSH 07:31-07:51 freeze):** the platform lock that
  INVENTORY_LOCK_TOKENS takes stays held until the top-level run ends, not just the engine call.
- **The rule the user chose:** at most one stock call per worker run, with no further job and no sleep after it.
- **Where GD_EDIT_WORKER broke it:**
  - Each GD Edit job makes exactly one stock call (E1: INVENTORY_BULK_APPLY APPLY, all of the job's movements in one
    operation). PREPARE's PLAN takes no locks.
  - But a run with no job_id (the GD list's and Picking Plan list's kicks) took up to 5 due jobs (LIMIT 5, 20 s budget).
  - So job 2's E1 could run while job 1's keys were still blocked, in another lock order.
  - Runs for a named job_id (the form, the SO save cascade, Force Complete) already took only that job.

## The change (2 nodes)

- `sql_node_GWpoll`: LIMIT 5 -> LIMIT 1.
- `code_node_GWplan`: its comment says why.
- Built from `scratchpad/gde/build_gde.py`; the rebuild differs from v8 in exactly these two nodes.

## Evidence

- `scratchpad/gde/test/test_worker.js`: 19/19. Lint: no serious findings.
- The new poll ran read-only on prod (128671) and dev (496474).
- Dev: published as v9 at 11:02 (the user's yes; backup v8_20261026-105839). Idle smoke OK (worker_route IDLE).

## After the paste

Check: `.dbtools/wf --prod deployed "Goods Delivery/EditV2/GD_EDIT_WORKER.json"` must say IDENTICAL as 'GD_EDIT_WORKER'
(id=2110618789356687361).
