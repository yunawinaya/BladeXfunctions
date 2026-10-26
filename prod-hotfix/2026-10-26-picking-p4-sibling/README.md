# Picking V2: P4 header race no longer waits for a kick, 2026-10-26

**Paste into: PICKING_BULK_COMMIT (id 2109531367339180034).** Not PACKING_BULK_COMMIT (look-alike name; on 10-24 a paste
landed there), and not PICKING_BULK_PREPARE.

## What goes wrong on prod (v13)

- **The race (10-25 16:07, LSH PI-2610-3490):** two web Auto Pick jobs on Pickings that share a delivery (Full Picking)
  update that delivery's header picking status one after the other.
  - Our job planned In Progress. A sibling job then wrote Completed, from facts that already included our picks.
  - Our read-back saw Completed and called it a mismatch, so P4 scheduled a retry.
- **The wait:** a retry moves only on the next PICKING_ASYNC_WORKER kick, which comes from a Picking list or form open.
  This one waited 2 min 50 s, with the Picking locked and its Packing not yet created. The retry then found
  "Completed -> Completed".
- **Retry rows carry text:** PCentry declares attempts / row_version as strings, so `n + 1` and `rowVersion + 2`
  concatenated.
  - Every LSH job's row_version ended above 100 (e.g. 2222).
  - The attempt count ran 0 -> 01 -> 11, so a job went to review one retry early.

## The change (15 nodes)

- **`sql_node_PCp4back`** reads the facts again after the write: the same rows as `sql_node_PCp4facts`, lines and headers.
- **`code_node_PCp4check`** recomputes each header from those fresh facts with P4's own roll-up.
  - A header holding our value, or the fresh roll-up, is right.
  - Only a header at neither value retries (a stale sibling write or a lost write), as before.
- **13 nodes' retry rows** read attempts and row_version as numbers.

## Files

| File | What it is |
|---|---|
| `PICKING_BULK_COMMIT.json` | Paste this. Prod v13 plus the change |
| `PICKING_BULK_COMMIT.prod_v13.json` | Prod's live v13 (2026-10-24 13:32:24), read 10-26; byte-identical to dev v13 |
| `patch_commit.py` | Builds the paste file from v13 with exact, counted replacements |

## Evidence

- `scratchpad/pk1d/test/test_p4_sibling.js` runs the built check node.
  - v13 fails the sibling case and writes "11" / "22"; the fix passes all 5 cases:
    - our value read back;
    - a sibling's newer value is accepted;
    - a stale sibling value still retries;
    - a lost write still retries;
    - retry rows carry numbers.
  - The existing test_commit_pm, test_commit_fc (9/9) and test_worker_fc (8/8) pass on the fix.
- **Lint:** no new real findings. Four new UNDECLARED lines are the linter reading the embedded roll-up function's
  `return { rows, need, count, skipped }` as the node's return.
- **Dev:** published as v14 at 06:52:10 (the user's yes; backup v13_20261026-064925).
  - Smoke as admin@496474: an Auto Pick of PI-20261022-0106 (GD/20261022/114). Job 2114490321348120578 COMPLETED in one
    worker call (9 s).
  - P0, P1, P3, P4 and P5 DONE.
  - row_version 6, attempt_count 0.
  - GD header and lines picking Completed; Picking unlocked.

## After the paste

Check the target: `.dbtools/wf --prod deployed Picking/AsyncV2/PICKING_BULK_COMMIT.json` must say IDENTICAL, as
'PICKING_BULK_COMMIT' (id=2109531367339180034).
