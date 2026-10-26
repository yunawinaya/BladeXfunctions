# Picking adds text quantities as numbers (2026-10-26)

## Paste targets

| Workflow | id | Paste file | Prod base |
|---|---|---|---|
| `PICKING_BULK_PREPARE` | 2109531157594619905 | `PICKING_BULK_PREPARE.json` | v12 (enabled 2026-10-21 11:01), saved here as `PICKING_BULK_PREPARE.v12.json` |
| `PICKING` (classic) | 2020683258347081730 | `PICKING.json` | v155 (enabled 2026-10-20 13:52), saved here as `PICKING.v155.json` |

Dev runs both since 2026-10-26 17:07: PICKING_BULK_PREPARE v13 and PICKING v156, each identical to the repo file.

## The bug

GD Created V2 stores some allocation quantities as text: `"gd_quantity":"100"`, written by GD_BULK_PREPARE
`code_node_egoCivrm`. That node belongs to the GD Completed & Created V2 session, which is fixing the writer.

Picking added these quantities with `+=` / `s + (e.gd_quantity || 0)`, so text was joined instead of summed.

- **KF 073522, PICK-FG2610-160 / DO-FG2610-161, 10-26 16:19:**
  - the loading-bay merge (`code_node_PPmove`) turned 5 × "100" into "100100100100100";
  - GD_REPLAN refused the confirm (total ≠ gd_qty 500), and nothing was saved;
  - the view stock read `Total: 0100100100100100`.
- **The bug report's second cause is wrong.** The SO edit at 15:03 did not write the text: it was already stored when the
  delivery was created at 12:48.
- **Scale.** Since 10-23, text quantities appear only on deliveries created through the V2 form save (961 text vs 1,637
  numeric lines on 10-26). 659 open lines in 8 tenants hold them.
- **Exposure.** The merge only runs with the loading bay on, and only KF has it on.

## The change (5 code nodes, nothing else)

Each addition converts first: `(Number(a) || 0) + (Number(b) || 0)`, and the totals use `s + (Number(e.gd_quantity) || 0)`.

| Workflow | Node | What it adds |
|---|---|---|
| PICKING_BULK_PREPARE | `code_node_PPmove` | loading-bay merge (gd / unrestricted / balance) + view-stock total; rebuilt from `scratchpad/pk1c/code/move.js` + `prepare_move_tail.js` |
| PICKING_BULK_PREPARE | `code_node_PPfc` | Force Complete view-stock total (`scratchpad/pk1d/code/view_stock.js`) |
| PICKING | `code_node_iES7iMKA` | the classic loading-bay merge + view-stock total |
| PICKING | `code_node_AGoxWP7x` | merge (unrestricted / balance) |
| PICKING | `code_node_MNRecompute` | view-stock total + picked total |

Behaviour with numeric data is unchanged, with one exception: a merged entry that lacks `unrestricted_qty` /
`balance_quantity` now gets 0 where it used to get NaN, which was stored as null.

Builder: `patch_text_qty.py` (from the repo root). It needs the fixed sources and asserts every edit.

## Evidence

- `scratchpad/pk1c/test/test_prepare_move.js`: new case "text quantities merge into the bay as numbers".
  - Before the fix it failed with `"55"` / `Total: 055 PCS`; it now passes, and the whole file passes.
- `scratchpad/pk1d/test/test_view_stock.js` 27/27.
  - This includes parity with classic `buildViewStock`, read from the patched PICKING, and a new explicit "Total: 200 PCS"
    for text input. That case failed before the fix.
- The other Picking V2 suites pass: pk1d `test_fc_plan` 39/39, `test_prepare_fc`, `test_submit_fc`, `test_worker_fc`,
  `test_drive`, `test_commit_fc`, `test_p4_sibling` and more; pk1c `test_prepare_plan`.
  - Three tests need recorded fixtures that are not present, unrelated to this change: pk1c `test_move` / `test_replan_parity`,
    and pk1d `test_gde_fc_prepare`.
  - `test_picking_wa_guard` fails by design: it tests the shelved Kenhin pre-check.
- Lint is unchanged for both files. Only the 5 nodes above differ from the bases, and each compiles.
- Not run live: dev has no loading-bay org with text quantities. KF's next multi-bin confirm after the paste is the live check.

## This case (KF)

The line was rewritten to numbers at 16:54:55 (`"gd_quantity":100` ×5). PICK-FG2610-160 is Created and unlocked, so it can be
confirmed again now; it does not need this paste.

## After the paste

`.dbtools/wf --prod deployed Picking/AsyncV2/PICKING_BULK_PREPARE.json` and `… Picking/PickingProcessWorkflow.json`
(run the second from outside the repo: PICKING clashes with the Picking/ folder) must each say `IDENTICAL`, as
'PICKING_BULK_PREPARE' (id=2109531157594619905) and 'PICKING' (id=2020683258347081730). The prod designer may add empty
default fields to sql-nodes on save; that is cosmetic.
