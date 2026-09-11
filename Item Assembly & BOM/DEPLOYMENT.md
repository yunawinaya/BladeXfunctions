# Item Assembly & BOM — deployment notes

## Status

| Artefact | Dev state (checked 2026-09-11) |
|---|---|
| `BOMFullJSON.json` | **enabled v70 — IDENTICAL to repo** |
| `BOMsaveWorkflow.json` | **enabled v4 as `BOM_SAVE` `2098308362750185474` — IDENTICAL** |
| `BOMlistPageJSON.json` | **enabled v4 as page `Basic BOM` `2098296691163975682` — IDENTICAL** |
| `ItemAssemblyListPageJSON.json` | **enabled v4 as page `Item Assembly` `2098312073316716546` — IDENTICAL** |
| `ItemAssemblyFullJSON.json` | enabled v8 — handlers identical, but the "no status badge on Add" change is **not deployed yet** |

List pages live in `su_code_pages` / `su_code_pages_history`, same
`status='enabled'` mechanism as forms and workflows — not in `su_code_tables`.

**Outstanding:** re-paste `ItemAssemblyFullJSON.json` only.

## Permission codes must be registered FIRST

`blade_menu` (category 2) is the button-permission registry. Of the 35 codes used
across every list page in this repo, **31 are registered** — and the only 4 that
are not are the ones on these two new pages. Every established page registers its
codes, so treat registration as required, not optional.

Create these five before pasting the pages:

| Code | Page | Button |
|---|---|---|
| `bom_delete` | Basic BOM | Delete |
| `ia_view` | Item Assembly | View |
| `ia_edit` | Item Assembly | Edit |
| `ia_delete` | Item Assembly | Delete |
| `ia_add` | Item Assembly | Add New |

`bom_add`, `bom_view` and `bom_edit` already exist.

**Ordering matters.** Item Assembly's Add New previously had an *empty*
permission, i.e. no gate at all; it is now `ia_add` to match its siblings. If the
platform hides buttons whose permission code is unknown, Add will disappear until
`ia_add` is registered — which would block testing the form. Register the codes,
then paste. If Add does vanish, that one field is the cause.

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
