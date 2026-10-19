# BUG-20261016-023: TAF CA-4098 Picking rejects an exact 32.95 pick

TAF (681409) user RINA opened a Picking from Picking Plan CA-4098 (CF-T439, 32.95 M/T) and typed 32.95.
The `picked_qty` validator answered "Quantity is not enough to pick". The platform drops a value that fails
its validator, so all four submits (15:15, 15:16, 15:25, 15:27 MYT, PICKING_LOOP exit `return_node_RAigIr20`)
reached the server with `picked_qty` empty and got "At least one item must have picked quantity greater than 0".

## Root cause

The row's `pending_process_qty` was **32.94999999999999**, which displays as 32.950.

1. The Picking Plan form sent `to_qty = 304.95 - 272 = 32.94999999999999`.
2. PICKING_PLAN rounds `to_qty` with q8 before writing it. It does not round the auto-allocated
   `temp_qty_data.to_quantity`, which it writes raw. That column is TEXT, so the platform never trims it.
3. PP_Convert_Picking sums `to_quantity` raw into `qty_to_pick` / `pending_process_qty`.
4. The validator compares with a strict `pending_process_qty < picked`.

Someone hand-edited the plan line's `temp_qty_data` to `32.95000000` at 15:44 MYT. The `update_time` is in UTC,
which points to a direct SQL write. At 15:51 RINA completed **PK-04110** (32.95 picked, records and reservation
consistent, plan Completed). No data repair is needed. No other open prod plan line carries residue (3 TAF lines
since August, all closed).

## Fix (three layers, each verified against the real prod run)

| Where | Node | Change |
|---|---|---|
| Picking form, Picked Qty validator (both copies) | column 23 `options.validator` + `rules[0].func` | reject only when `picked - pending > 0.0005` |
| PP_Convert_Picking | `code_node_8MJPH5aT` Map Picking Data | q8 on `remainingQty` and on each row's summed `qty_to_pick` / `pending_process_qty` (also stops a 1e-16 phantom row for a fully picked bin) |
| PICKING_PLAN | `code_node_8Z1krUr1` Table TO | q8 on every `temp_qty_data[].to_quantity`, lines and bundle children |

`replay.js` runs the real code: 9 of 17 checks fail on the deployed prod code and all 17 pass when patched.
A BASE vs patched replay of RINA's recorded runs changes only `qty_to_pick` / `pending_process_qty` (convert)
and `temp_qty_data` (Table TO).

## Files

- **Prod PP_Convert_Picking**: paste `Picking Plan/PPconvertToPicking.json`. Dev v29 and prod v29 are identical,
  so one file serves both.
- **Prod PICKING_PLAN**: paste `PICKING_PLAN.prod.json` (prod v47 plus the fix). Do NOT paste the repo file:
  dev v65 also carries the `picking_uom` change in `code_node_cDgPpyos`.
- **Prod Picking form (v179)**: paste `PickingFullJSON.prod.json` (prod v179, with only the two validator copies
  changed). Do not paste the dev form, because prod has its own edits.
- `build.py` rebuilds every file from its baseline and asserts the exact text it replaces.

## Deployed

- **Dev, 2026-10-16 16:10**: PP_Convert_Picking v30, PICKING_PLAN v66, Picking form v435, all IDENTICAL to the repo.
  Backups of v29 / v65 / v434 are in `~/Documents/ASC-dev/workflow-backups/dev/`.
- **Prod, 2026-10-16 16:11-16:14**: PP_Convert_Picking v18, PICKING_PLAN v48, Picking form v180, all IDENTICAL to the
  files above.
