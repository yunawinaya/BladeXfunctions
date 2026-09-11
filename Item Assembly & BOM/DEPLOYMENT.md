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

## Button permissions: why Add New was hidden

The Add New button on the new pages originally carried `bom_add`. That code *does*
exist and is granted to 165 roles — but it is a **child of the legacy "Bill of
Material" page's menu** (`1909203642444423170`), so it does not resolve on a
different page. Emptying the permission was the right way to unblock testing.

Button permissions are `blade_menu` rows with `category = 2` whose `parent_id` is
the **page's own menu id**. Both new pages have a menu but no buttons under it:

| Page | Page id | Menu id | Buttons defined |
|---|---|---|---|
| Basic BOM | 2098296691163975682 | `2098296690920706050` | **0** |
| Item Assembly | 2098312073316716546 | `2098312072972783618` | **0** |
| *(legacy)* Bill of Material | 1909092705255301122 | 1909203642444423170 | 3 (`bom_add`/`bom_view`/`bom_edit`) |

So the fix is not simply "register the codes" — each button permission has to be
created **under its own page's menu**, then granted to the roles that need it:

- under menu `2098296690920706050`: a Delete button for `bom_delete` (View / Edit /
  Add already point at the legacy menu's codes and have the same problem)
- under menu `2098312072972783618`: `ia_view`, `ia_edit`, `ia_delete`, `ia_add`

Of the 35 permission codes used across every list page in this repo, 31 are
registered; the only 4 that are not are `bom_delete` and the three `ia_*` codes on
these pages.

**Until that is done, keep the live Add New permission empty** — the repo now has
`ia_add`, so pasting `ItemAssemblyListPageJSON.json` will hide the button again
and block form testing. Create the permissions, grant them, then paste.

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

## The save workflow

`ItemAssemblySaveWorkflow.json` → `IA_SAVE` **2098335576774463489**. 79 nodes.
`button_draft` and `button_completed` are wired to it; `comp_post_button` and
`button_post` stay unbound (posting is a later phase).

Two legs, matching the module's shape: **subtract** every component pick
(`SUBTRACT_INVENTORY` 2012096660219564034), then **add** the assembled item
(`ADD_INVENTORY` 2012005532688723970). Those are the ids every Stock Movement
module uses — the repo filenames say "Old", but only Goods Delivery uses the
`_NEW` pair.

Order of operations on Completed: validate → idempotency guard → pre-flight
inventory check over every pick → resolve the batch → persist the header →
re-read it for the real document number → issue leg → cost roll-up → receipt leg
→ HU unload → item transaction date. The batch is resolved *before* the write so
a generated number lands on `batch_no`, not just on the inventory movement.

**Validation, with distinct return codes** so the client can tell them apart:
400 required fields / inventory-engine failure, **401** allocation mismatch,
empty picks, zero quantity or a missing manual batch, **402** inventory shortfall
found by the pre-flight check, **409** already Completed.

**Costing.** Each `SUBTRACT_INVENTORY` returns the actual cost of what it
consumed. Those accumulate across the two nested loops in Redis, then the
assembled item is received at
`(sum(qty x unit_price) / item_qty) + Item.assembly_cost`.

The Redis key is `iaCostAccum_{{node:code_unique.data.unique}}` — namespaced per
**run**, not per user. `code_unique` mints `<issued_by>_<timestamp>` as node #2.
MSR keys its equivalent on `issued_by` alone, so two concurrent saves by one user
corrupt each other's accumulator; SRR and Putaway already mint a unique value.
`{{node:...}}` interpolation inside `redis_key` is used 188 times across this repo.

**`custom_wkbocgni` is a FIXED key name on a set-cache-node** — 127 uses repo-wide,
never varying. The runtime looks it up by that exact name; deriving a suffix from
the node id throws
`NullPointerException ... because "custom" is null` at runtime, with nothing in
the JSON to hint at it.

**`trx_no` must be the RESOLVED document number.** The fillback node writes the
literal `'issued'` sentinel, which the serial engine only replaces during the
write. So the header is persisted first, `code_persisted` re-reads the saved row
(`get_ia` on Edit, the add-node's response on Add), and every `SUBTRACT` /
`ADD` stamps `trx_no` from there. Taking it from the fillback copy stamps the
literal string `issued` onto every inventory movement — invisible until you go
looking for the document's movements and find none.

**Idempotency reads the DB, not `allData`.** `get_persisted_ia` +
`code_idem_guard` refuse a re-save of a `Completed` / `Fully Posted` document
with 409. The client payload carries whatever the browser had, so a stale tab or
a double-click would otherwise move stock twice.

**Batch for the assembled item**: not batch-managed → none; `Manual Input` →
`batch_no` is passed as `batch_number` (a string makes ADD_INVENTORY resolve or
create the Batch); `According To System Settings` → `GENERATE_BATCH` first.

**Numbering** uses the sentinel: `'draft'` on Draft, `'issued'` otherwise, guarded
on `stock_movement_no_type !== -9999`. A Draft *edit* does not renumber
(`update_draft` omits both number columns); promoting Draft → Completed does.

**Known limitation, stated plainly:** the pre-flight check makes a failure
unlikely, but the commits are still line-by-line with no rollback. A failure
midway through the issue leg leaves the earlier components already deducted. This
is the same exposure MSI carries; compensating reversals were considered and
judged disproportionate.

## How to read this module

**The header is one MSR receipt line** — the assembled item going IN to stock.
Not the MSR *header*: the analogue is a single row of MSR's `stock_movement`
table, which is why the header carries storage location, bin, batch,
manufacturing/expired date and its own remarks. IA's `remarks` even shares MSR's
component key `zq62c1v9`.

**The subform is MSI** — the components going OUT of stock. That is why the
Transfer Stock dialog, `temp_qty_data` / `temp_hu_data` and the allocation rules
are ported from Misc Issue.

Consequences already applied:

- `onChange_Plant` defaults the receiving storage location with
  `location_type: "Common"`, matching MSR's receipt default.
- Header remarks are `remarks` / `remarks_2` / `remarks_3` — the `_2`/`_3`
  underscore convention MSR uses on its *lines* (`item_remark_2`,
  `item_remark_3`), not the `remark2`/`remark3` spelling on MSR's header.

When the save pipeline is built it needs both legs: an MSI-style issue for every
component line and an MSR-style receipt for the header item, including batch
creation when the assembled item is batch-managed.

## Draft status

`draft_status` (badge) and `button_draft` were added to the form. Wiring, matching
Misc Issue and Handling Unit:

- `showStatusHTML` maps `Draft -> draft_status`.
- Add / Clone display the Draft badge and the Draft button.
- On Edit a `Draft` record shows the Draft button alongside Completed and
  Complete & Post, and **the header stays editable** — every later status locks
  it. A draft you cannot edit would be pointless.

`item_assembly_status`'s datasource was filtered to `Issued` / `Completed` /
`Fully Posted`, so `Draft` could never have been stored through the select even
though the value exists in the dictionary. `Draft` is now in that allow-list, in
lifecycle order.

`button_draft` still has an empty `onClick`, like the other three — the save
pipeline remains deferred.

## Project cascade

The header Project pushes down onto the component lines, following
`Sales Order/SOonChangeProject.js`: blank lines take it silently, lines already
carrying a *different* project prompt Overwrite / Keep, and clearing the header
never wipes the lines.

Sales Order wires the same handler to its line table's `onRowAdd`. That hook does
not exist here because the components table is locked to the BOM, so the BOM
explosion seeds `project_id` on the rows it creates instead.

## Component line behaviour

**Two quantities.** `requested_qty` is what the BOM calls for (read-only,
re-derived from `item_qty`); `total_quantity` is what was actually allocated.

**The Transfer Stock dialog now gates on the difference.** Confirm is refused
unless the allocated total equals `requested_qty`, naming the shortfall or excess.
The guard returns *before* any `setData` and before `closeDialog`, so the dialog
stays open with the entered quantities intact and they can be adjusted rather
than re-entered. A row with `requested_qty` of 0 is not gated.

Auto-allocation can still leave a line short — it reports the shortfall rather
than blocking — and the dialog is where that gets resolved. Final enforcement at
Complete belongs to the deferred save pipeline.

**`stock_summary` shows names, not ids.** Bin (`bin_location_combine`), batch
(`batch_number`) and UOM (`uom_name`) are all resolved, batched across every line
in two queries, and formatted the same way `onConfirm_Stock` writes it so a manual
re-pick reads identically.

**Plant follows the login, as in MSI.** `setPlant` in `mounted` compares
`getVarSystem("deptIds")[0]` against the organization: a plant-level login gets
`issuing_operation_faci` auto-filled and **disabled**, an org-level login picks
one. It delegates to the `onChange_Plant` handler via `triggerEvent` so the
storage-location and bin defaults are resolved in exactly one place. The
components table is disabled until a plant is set.

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
