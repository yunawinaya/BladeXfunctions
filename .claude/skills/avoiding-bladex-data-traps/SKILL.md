---
name: avoiding-bladex-data-traps
description: Use when editing a BladeX save workflow or inventory code - adding or writing any decimal/quantity column, reconciling child rows (on_order, allocations), building an item-picker dialog, or touching GD allocation and reservation. Also use when a save crashes with "multipleOf not match", "minimum not match, expect >= 0", or "所选流水号规则不属于当前部门", or when a quantity double-counts or a column silently stays blank.
---

# Recurring data-integrity traps

These are the bug classes that keep recurring in this ERP. Each has bitten more than once. Check
the relevant one *before* writing, not after the save crashes in prod.

## Writing a decimal column → check the formatNumber map FIRST

Every module's save workflow has **one code-node that `toFixed`-strings every decimal column**
before the insert/update (GDheadWorkflow `code_node_GKc0ALEe` "Table GD", GR `fillbackHeaderFields`).

**That node is an ALLOW-LIST, and that is the trap.** A decimal column not named in the map passes
through as a raw float; the serializer eventually emits full precision (`1.6` → `1.5999999999999999`)
and the DB's BigDecimal `multipleOf` check rejects it, crashing the entire save.

It hides well: the column works for months, then one *multiplication or division* result
(`gd_qty × base_qty_factor`, `total ÷ qty`) lands on a value that doesn't serialize cleanly.

**Rule: whenever a decimal column is added, or starts being written from a new place, open the
module's format node and confirm it is in the map.** Do not reason about whether that particular
value "should" serialize cleanly. It costs one line. This has been overlooked repeatedly.

Related: a decimal returned from a **sub-workflow** (`workflow_node_*`) needs `toFixed()` at the
consumer, emitted as a **STRING** — `parseFloat({{node:X.unitPrice}} || 0).toFixed(4)`. Server-side
BigDecimal division produces values like `0.7505` → `0.7504999999999999`. Returning a Number cannot
fix it; only the string form coerces cleanly.

## Writing a remainder/outstanding/open qty → clamp at 0

Several quantity columns enforce `minimum >= 0`. When over-delivery or over-receipt is **allowed by
tolerance** (validation correctly passes), the computed remainder (`ordered − delivered`) goes
negative and the platform rejects the write:
`property X invalid; minimum not match, expect >= 0, but -N` — failing the whole workflow.

**Clamp with `Math.max(0, ...)` at EVERY branch that writes the value**, and specifically at the
last transform before the DB write. A clamp upstream in an allocation node does **not** protect a
save-time validator that re-reads the form value.

## Reconcile nodes (fetch → toAdd/toUpdate/toDelete) → key on something immutable

A reconcile is only correct if its fetch key **cannot change between saves**. Keying on header
fields silently turns an update into a duplicate insert.

Real case: PO `search_onorder` matched on `purchase_order_number + plant_id`, but `po_plant` stays
editable on an *Issued* PO. Change the plant, save → nothing matches, every line falls to `toAdd`,
and you get a second full set of rows with the first orphaned. Downstream GR matches `po_line_id`
alone, so both rows get written and the on-order qty double-counts.

- Fetch on the immutable id (`po_id`), OR-ed with the legacy key for older rows:
  `all[ organization_id, any[ po_id numberEqual, <legacy key> equal ] ]`.
- Match against `mine.concat(orphan)` so legacy rows get adopted — but **sweep only `mine` into
  toDelete**. Never delete a row that might belong to a sibling document.
- Re-stamp every parent-owned column, not just quantities. Never write the column a downstream flow
  owns (`received_qty` belongs to GR).
- **search-node `limit` is an allow-CEILING, same trap as the format map**: a document with more
  lines than the limit silently re-adds the rows past it. 1000 is the max used in this repo.

## Item pickers → subtract what OTHER lines already staged

Picker dialogs compute availability from `item_balance`/`item_batch_balance`, but staged picks live
in per-line temp JSON (`items_temp_data`, `temp_qty_data`, `temp_hu_data`) that is **not written to
the DB until completion**. So every other line still sees that stock as free, and N lines can each
claim the same quantity. The per-row clamp never catches it — it clamps against its own row.

Walk sibling lines' temp blobs, skip `idx === rowIndex`, sum staged qty per balance key, subtract.
Scope the key to the physical source (HU id, or "loose") — never deduct across different HUs that
merely share a balance row. Use ONE key-builder for every map compared against the same rows.

**Trap when auditing this class: the guard may live in the form JSON, not the JS.** Grep
`<MOD>fullJSON.json` for `options.validator` before concluding a module is unprotected. MSI/LOT/PT
are protected that way. Each carries TWO `sm_quantity` validators — the one on
`balance_index > sm_quantity` does NOT aggregate and is a decoy.

## Rows that are not inventory rows

`stock_control === 0 && show_delivery === 0` means the line is **description-only** — treat it
exactly like a row with no `material_id`. No allocation, no balance lookup, no stock movement.
Otherwise auto-allocation returns "Partial allocation. Available: 0" for items that by design have
no inventory.

`stock_control === 0` **alone** is a different mode (non-stock but still shown in delivery flows) —
do NOT treat as description-only. `GDgdQtyValidation.js` uses the single check deliberately, for a
stricter "is there inventory to check?" question. Don't conflate them.

## Serial-number rule lookups → filter department_id

`流水号规则表` is org-shared, so `business_type + is_draft + is_default` returns **one row per
tenant**. Taking `rules[0]` grabs whichever tenant sorts first and the add-node throws
`所选流水号规则不属于当前部门`.

Always add `prop:"department_id", operator:"numberEqual", valueType:"field",
value:"{{global:firstLvDeptId}}"`. **`limit: 1` does NOT bound this search** — a trace returned all
19 rows with `limit:1` set. Never rely on the cap to make `rows[0]` deterministic. Use the global,
not a sibling node's fetched `organization_id` (that would be a divergent reference).

## Inventory movement specifics

- **`isMovingInv: 1` does not uniformly reuse the balance row.** Moving *category* reuses it;
  moving *location* or *batch* creates a NEW row, because those are part of the natural key.
  Rewrite `balance_id` downstream when location or batch changed.
- **`movement_type` is Title case — `In` / `Out`.** Writing `"IN"`/`"OUT"` leaves the cell blank:
  the model holds the value, the select just cannot label it. Readers must uppercase-compare for
  legacy rows.

## GD allocation / release order

Allocate (creating or increasing a GD): **Production → Sales Order → Good Delivery** (unrestricted).
Release (cancelling or decreasing): the exact reverse — **Good Delivery → Sales Order → Production**.

When creating Pending records from splitting or releasing: clear `doc_id`, `doc_no`, `doc_line_id`;
preserve the chain with `source_reserved_id: record.source_reserved_id || record.id`; clear
`target_gd_id`.

## Symptom → cause

| Error / symptom | Cause |
|---|---|
| `multipleOf not match` | decimal column missing from the format map, or a sub-workflow decimal not `toFixed`-stringed |
| `minimum not match, expect >= 0` | unclamped remainder under tolerance-allowed over-delivery |
| `所选流水号规则不属于当前部门` | serial-rule lookup missing `department_id` |
| Quantity double-counts after an edit | reconcile keyed on a mutable header field |
| Two lines each claim the same stock | picker not deducting sibling lines' temp blobs |
| "Partial allocation. Available: 0" on a service item | description-only row not excluded |
| Column stays blank but the record has the value | casing mismatch against the select's options (`In`/`Out`) |
