# Item Assembly & BOM — deployment notes

## Status

| Artefact | State |
|---|---|
| `ItemAssemblyFullJSON.json` | **DEPLOYED dev v8** — all 26 handlers byte-identical, every structural change survived |
| `BOMsaveWorkflow.json` | **DEPLOYED dev** as `BOM_SAVE` id `2098308362750185474`, enabled v3, identical to repo |
| `BOMFullJSON.json` | deployed v69, then **two bugs found by testing — needs re-paste** |
| `BOMlistPageJSON.json` | repaired (filters, columns, Delete), **not deployed** |
| `ItemAssemblyListPageJSON.json` | filled in (datasource, columns, filters, Delete), **not deployed** |

The three new columns exist on dev: `sm_item_assembly_tlm8ve69_sub.requested_qty`
`decimal(65,3)`, and `serial_number` / `material_id` on
`sm_item_assembly_mw10kf66_sub`.

**Outstanding:** re-paste the BOM form **and** the save workflow (both changed after
the 2026-09-11 test), and paste the list page.

## What the first live save exposed

Run `2098311821994020865` completed in 165ms with no error, wrote the header and
both child rows, and got version / version type / decimals / `bom_type` /
`consume_type` right. Two things were wrong anyway — both silent:

1. **`code_format` read `{{node:get_parent_item.data}}`.** That is the
   `{count, data}` envelope, not the record. It is *truthy*, so the `if (item)`
   guard passed and every field read `undefined`; the add-node then omitted those
   columns entirely rather than failing. Result: `parent_material_name`,
   `parent_material_desc`, `parent_material_category` and `parent_mat_base_uom`
   saved empty. Fixed to `.data.data` — the form the deployed GD workflow uses.
   The authoring skill has been corrected.
2. **The client never sent those four fields either.** `arguments[0].fieldModel.item`
   was empty on the header picker (it works on the subform one). Both pickers now
   read the item back by id with a projected `.field()` query instead of trusting
   the event payload, so the form displays them too.

Re-saving the existing test BOM through the fixed form will backfill it — the Edit
path re-derives all four from the Item.

**`sub_tenant_id` is a non-issue here, contrary to the earlier note.** It is a
physical column but is *not declared* in `bill_of_materials`'s `schema_json`, so
the platform never stamps it and a workflow cannot write it. NULLs are normal on
this table (and on `process_route_yes81y2n_sub`, 44 of 50). The carry-forward in
`code_guard` still earns its place on edits of the 40 legacy rows that do have a
value.

The fork-join is genuinely parallel — verified from `nodes_data`:
`search_sibling_boms` and `get_parent_item` both start at the same millisecond and
`code_guard` waits for the slower one.

## Deploy order

Steps 1, 2 and 4 are done. What remains:

1. ~~Create the three columns in the field editor~~ — done.
2. ~~Deploy `BOMsaveWorkflow.json`~~ — done, `BOM_SAVE` `2098308362750185474`.
   Its id is now wired into `BOMsave.js`, so **the BOM form must be re-pasted**:
   the v68 currently in `designing` still carries the placeholder id and would
   fail on every save.
3. **Paste `BOMFullJSON.json` again and enable it.**
4. ~~Deploy `ItemAssemblyFullJSON.json`~~ — done, v8.
5. **Paste `BOMlistPageJSON.json` and enable it.**
6. **Paste `ItemAssemblyListPageJSON.json` and enable it.**

## Columns (done)

`requested_qty` on `sm_item_assembly_tlm8ve69_sub`, plus `serial_number` and
`material_id` on `sm_item_assembly_mw10kf66_sub`, all created on dev.
`table_item_balance_raw`, `search_serial_number`, `confirm_search` and
`reset_search` are transient and need no column — Misc Issue does not persist
them either.

## The BOM list page

It shipped with three defects, now fixed:

- **No filters.** Added Material Code, Material Name and BOM Version. Int filters
  (Active / Default) were *not* added — no list page in this repo filters an int
  field, so there is no shape to copy; they are columns instead.
- **A column bound to `bom_status`**, a field nothing writes, so it was always
  blank. Removed. Added `is_active`, `parent_mat_is_default` and
  `parent_mat_base_quantity`.
- **The Delete row action pointed at handler `oh26x9gl`, which did not exist**, so
  the button did nothing. `BOMlistDelete.js` now supplies it under that same key:
  it blocks deletion when a production order references the BOM, confirms, then
  soft-deletes the header **and its sub-material rows** — leaving children behind
  is how the 40 orphan rows already in this table were created.

`viewBtn` / `editBtn` / `addBtn` also reference `func_*` keys that are absent from
`eventScript`; that is normal — the platform auto-wires those. Only `type: "custom"`
actions need a real handler (confirmed against `PickingListPageFullJSON.json`,
where all 7 custom buttons resolve).

The existing `DELETE_BOM` workflow (`2005950986531250178`) was **not** wired: it
operates on `bom_tree`, a different table.

## The Item Assembly list page

Created from the BOM list page and left unconfigured. Four fixes:

- **The organization filter compared against a literal `null`**, so the grid
  would have returned no rows at all. Now the same field-based `any` branch the
  BOM page uses (`{{global:deptParentId}}` / `{{system:deptIds}}`).
- **No columns.** Added Item Assembly No, Status, Item Code, Item Name, Quantity,
  Date, Issued By, Posted Status.
- **No filters.** Added Item Assembly No, Item Code, Item Name and a Status
  select — the last cloned from the GD list page, which reads the same dictionary
  parent (`1914242988707749889`).
- **Delete pointed at `oh26x9gl`**, the BOM page's handler key, which does not
  exist in this file. `ItemAssemblyListDelete.js` now supplies it: it refuses when
  the assembly is `Completed` or `Fully Posted` (the components have already left
  stock), confirms, then soft-deletes the header and **both** child tables
  (`_tlm8ve69_sub` and `_mw10kf66_sub`).

Column shapes were cloned from pages already in the repo rather than authored. A
relation column turns out to be the *target* field's definition plus a `parent`
stub carrying only `foreignKey`, so `item_id.material_code` is BOM's
`parent_material_code.material_code` with a different `name`.

Both delete confirms HTML-escape the document number before interpolating it:
`stock_movement_no` and `parent_mat_bom_version` are free text whenever the
Manual Input serial rule is used, and the confirm renders with
`dangerouslyUseHTMLString`. (The same unescaped pattern exists in ~100 other repo
files — not audited here.)

## Datasource filters on the BOM form

Five remote selects shipped with an empty rule list, listing every row in every
organization. Now scoped: `parent_material_category`, `parent_mat_base_uom`,
`sub_material_category`, `sub_material_qty_uom` (organization), and `ref_bom_id`
(organization + `is_active`). `sub_material_bom_version` is left unfiltered on
purpose — it is deprecated and hidden.

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

    python3 scratchpad/patch_bom_form_filters.py     # datasource scoping (idempotent)
    python3 scratchpad/patch_bom_listpage.py         # BOM list page filters/columns/Delete
    python3 scratchpad/patch_ia_listpage.py          # IA list page datasource/columns/filters/Delete

`patch_bom_form.py`, `patch_bom_form_filters.py` and `patch_bom_listpage.py` are
idempotent. `patch_ia_form.py` is **not** — it drops handlers and clones
components, so run it only against a clean pre-repair checkout.
