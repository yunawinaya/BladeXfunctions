# Picking makes a hidden "Waiting" Packing visible when it fills it (2026-10-26)

**Paste BEFORE the GD session's GD_BULK_COMMIT P7A change** (the change that leaves the save-time shell at "Waiting"). If
theirs lands first, a picked delivery's Packing stays invisible.

| Workflow | id | Paste file | Prod now | Dev |
|---|---|---|---|---|
| `PICKING_BULK_COMMIT` | 2109531367339180034 | `PICKING_BULK_COMMIT.json` | v14 (06:54) | v16 (19:38), identical |
| `PICKING` (classic) | 2020683258347081730 | `PICKING.json` | "v82" (17:15) = `PICKING.v156.json` | v157 (19:38), identical |

`PICKING_BULK_COMMIT.json` also carries the phase-B header re-check (v15, `../2026-10-26-lsh-picking-header/`). It supersedes
that folder's paste file: paste only this one. `PICKING.json` carries this afternoon's text-quantity fix, already on prod.

## Why (user, 2026-10-26)

The GD session's save-time Packing shell showed up empty at LSH ("Packing task doesn't have item": 38 since 10-23, and
Pickings are made by hand there). The user chose to keep the shell but hide it until picked:

- **The GD session** leaves it at `packing_status = "Waiting"`: P2 writes "Processing", and P7A writes "Waiting".
- **Packing** hides "Waiting" on the desktop list and in the mobile app (by over-the-air update).
- **Picking (this change)** makes it visible when it fills it.

Picking creating the Packing instead was rejected: at LSH, Pickings of one delivery finish within 2 s of each other 95 times
in 1.2 days, so a create race would be constant.

## The change

Both Picking paths already find the delivery's Packing by gd_id and refresh it, and neither writes `packing_status`. Each now
collects the shells still at "Waiting" and writes `packing_status = "Created"` for those rows only. The refresh still never
writes the status, so a Packing a packer has moved on is never reverted.

- **PICKING_BULK_COMMIT:**
  - `code_node_PCp5build` returns `unhideRows` / `hasUnhide`;
  - new `cor_PCp5unhide` → `update_node_PCp5unhide`, after the refresh, inside the chunk loop.
- **PICKING:**
  - `code_node_gudzrvMQ` returns `packingsToUnhide` / `hasUnhide`;
  - new `if_PkUnhide` → `update_node_PkUnhide`, after `if_PkUpdates`.

Builder: `patch_unhide.py Waiting <bases> <outs>`. Every edit is asserted.

## Evidence

- `scratchpad/pk1d/test/test_unhide_flow.js` (1c sim, SUBMIT → WORKER → PREPARE → COMMIT A → B):
  - a Waiting shell ends Created and filled;
  - an In Progress or Created Packing keeps its status;
  - v15 fails the Waiting case.
- `scratchpad/pk1d/test/test_unhide_classic.js` (classic builder) 3/3; v156 fails.
- Regression, all green on the installed builds: sim `test_flow` / `test_flow_1c`, the header re-check tests,
  `test_commit_fc`, `test_worker_fc`, `test_p4_sibling`, `test_view_stock`, `test_fc_plan`, `test_drive`, `test_prepare_move`,
  `test_commit_pm`.
- Lint is unchanged for both.
- **To come:** an end-to-end check on dev with the GD and Packing sessions, once the GD change is on dev.

## After the paste

`.dbtools/wf --prod deployed Picking/AsyncV2/PICKING_BULK_COMMIT.json` and `… Picking/PickingProcessWorkflow.json` (run the
second from outside the repo) must say `IDENTICAL`, as 'PICKING_BULK_COMMIT' (id=2109531367339180034) and 'PICKING'
(id=2020683258347081730).
