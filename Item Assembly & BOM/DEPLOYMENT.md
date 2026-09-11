# Item Assembly & BOM — deployment notes

## Status

| Artefact | State |
|---|---|
| `BOMFullJSON.json` | repaired, **not deployed** |
| `BOMsaveWorkflow.json` | new, **not deployed** — `BOMsave.js` holds a placeholder id |
| `BOMlistPageJSON.json` | unchanged |
| `ItemAssemblyFullJSON.json` | repaired + BOM explosion wired, **not deployed** |

Nothing here has been released. Dev still runs BOM form v66 (2025-12-26) and
Item Assembly v7.

## Deploy order

1. **Add the three missing columns through the platform field editor** (below).
   Pasting form JSON does not run the DDL that creates a physical column.
2. Paste `BOMFullJSON.json` into the BOM form's `designing` copy, then enable.
3. Paste `BOMsaveWorkflow.json` into a new workflow, enable it, then put its id
   into `BOM_SAVE_WORKFLOW_ID` in `BOMsave.js`, re-run
   `python3 scratchpad/patch_bom_form.py`, and re-paste the BOM form.
4. Paste `ItemAssemblyFullJSON.json`, then enable.

## Columns that need creating first

| Where | Field | Type | Physical table |
|---|---|---|---|
| `stock_movement` subform | `requested_qty` | number, precision 3, min 0, default 0 | `sm_item_assembly_tlm8ve69_sub` |
| `sm_item_balance > table_item_balance` | `serial_number` | input | `sm_item_assembly_mw10kf66_sub` |
| `sm_item_balance > table_item_balance` | `material_id` | input | `sm_item_assembly_mw10kf66_sub` |

Clone them from Misc Issue, which already has all three
(`requested_qty` there is key `ctr4vwvd`, `decimal(65,3)`, `precision: 3`,
`minimum: 0`, `defaultValue: 0`).

`table_item_balance_raw`, `search_serial_number`, `confirm_search` and
`reset_search` need **no** column — Misc Issue does not persist them either.

## The two quantities on a BOM Components line

- `requested_qty` — what the BOM requires. Read-only, derived as
  `(item_qty / parent_mat_base_quantity) × sub_material_qty × (1 + wastage/100)`,
  rounded up for serialized components. Re-derived whenever `item_id` or
  `item_qty` changes.
- `total_quantity` — what was actually allocated from stock. Written by the
  auto-allocator and by the Transfer Stock dialog.

The components table is locked to the BOM (`isAdd: false`, `isDelete: false`,
`item_selection` disabled): the only way to change it is to change the BOM or
`item_qty`.

## Auto-allocation — what it does and does not cover

Runs automatically after the BOM explodes and again on every `item_qty` change.
Eight queries total, independent of BOM size.

Availability follows the same rules the Transfer Stock dialog applies:
`item_balance.unrestricted_qty` is already net of Allocated loose reservations
(they bucket-shift to `reserved_qty` on save), so only HU-held stock is deducted,
minus each HU's own reserved portion. Oldest `create_time` first. Category is
always `Unrestricted` — the dialog's category column is pinned to it.

**It allocates loose stock only.** Serialized components are skipped entirely,
and stock held inside handling units is never auto-picked. Any shortfall raises a
warning naming the lines, and the user finishes those in the Transfer Stock
dialog. Widening this to HU picking means reproducing whole-HU semantics and the
packed-HU exclusion rules, which is where the GD auto-allocator has historically
gone wrong.

## Still open

- **Item Assembly cannot be saved.** `button_completed`, `comp_post_button` and
  `button_post` all have an empty `onClick`. Building that means porting
  `Stock Movement/Misc Issue/MSIsaveWorkflow.json` — issue leg, receipt leg,
  batch creation, costing roll-up, status transitions. Deliberately out of scope.
- **Prod was unreachable** while this was written (RDS timeout), so no prod claim
  here is verified. Before releasing, check that
  `bill_of_materials_ttux02kq_sub.sub_tenant_id` is populated in prod — legacy
  NULL children break any save that deletes a subform line.
- `bill_of_materials` child rows in dev are all orphaned (40 rows, no surviving
  parent). Worth a cleanup pass, separately.

## Re-running the tooling

    python3 scratchpad/gen_bom_save_workflow.py      # regenerate the workflow
    python3 scratchpad/patch_bom_form.py             # .js -> BOMFullJSON.json
    python3 scratchpad/patch_ia_form.py              # .js -> ItemAssemblyFullJSON.json (re-clones components)
    python3 scratchpad/verify_bom_ia_sync.py         # assert .js == embedded copy
    python3 scratchpad/audit_forms.py <form.json>    # dangling refs / orphans / bad model paths
    python3 scratchpad/validate.py "Item Assembly & BOM/BOMsaveWorkflow.json"

`patch_ia_form.py` is not idempotent for the handler drops — it is written to run
once against the pre-repair form. Re-run it only from a clean checkout.
