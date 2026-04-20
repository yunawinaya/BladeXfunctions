# Packing New Pack Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Packing module's pack flow so users can (a) generate new HUs and fill them by picking items from `table_item_source`, and (b) pick existing HUs wholesale from `table_hu_source` as locked rows in `table_hu`. Delete-row is the v1 reverse path.

**Architecture:** All pack state lives in `table_hu` on the Packing document. Each row carries a JSON-stringified `temp_data` field listing packed items. `table_item_source` rows derive their picked/remaining/status values live from every target HU's `temp_data` — single source of truth, no stored counters. `hu_row_type` flag ("generated" | "locked") distinguishes user-built HUs from source-copied ones.

**Tech Stack:** JavaScript (browser-side handlers in the low-code platform), JSON form schema at [Packing/PackingFullJSON.json](PackingFullJSON.json), `db.collection(...)` data-access API, `this.setData` / `this.getValue` form API, `this.$message` for toasts.

**Reference spec:** `/Users/yunawinaya/.claude/plans/so-this-is-packing-hazy-book.md`

---

## Collaboration Model

- **User** adds new fields, buttons, events, and tables in the low-code editor (platform-generated `key` values), then saves [Packing/PackingFullJSON.json](PackingFullJSON.json).
- **Assistant** writes the handler `.js` files in [Packing/](.) that the user then imports into the event slots.
- **Verification** happens in the low-code platform after each task (no unit-test framework in this repo).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `Packing/PackingRecomputeSource.js` | **New** | Pure helper: given current `table_hu` + `table_item_source`, return updated source rows (picked/remaining/status/qty_to_pick). |
| `Packing/PackingOnPickItem.js` | **New** | Flow A: Pick to HU click on a `table_item_source` row. |
| `Packing/PackingOnPickHU.js` | **New** | Flow B: Pick to HU click on a `table_hu_source` HU header row. |
| `Packing/PackingOnAddHU.js` | **New** | Add-row handler on `table_hu` — initializes a Generated row, triggers `handling_no` generation. |
| `Packing/PackingOnSelectHU.js` | **New** | Selection handler on `table_hu` — writes `selected_hu_index`, enforces single-select. |
| `Packing/PackingOnDeleteHU.js` | **New** | Delete-row handler on `table_hu` — clears `temp_data`, restores source state. |
| `Packing/PackingOnChangeQtyToPick.js` | **New** | Inline-edit clamp on `qty_to_pick` in `table_item_source`. |
| `Packing/PackingOnMounted.js` | **Modify** | Call `PackingRecomputeSource` at the end so source rows reflect loaded `temp_data`. |
| `Packing/PackingFullJSON.json` | **Modify (user)** | New fields/events wired. User edits in low-code editor. |

Existing handlers (`PackingOnChangeItem.js`, `PackingOnChangeHUqty.js`, `PackingOnChangePackingMode.js`, `PackingSave*.js`, `PackingOpenSelectItemDialog.js`, `PackingSaveSelectItemDialog.js`) remain untouched in v1 — they belong to the legacy pack flow and save/workflow pipeline we're not touching yet.

---

## Task 1: Low-code editor setup (USER)

**No code. User modifies [PackingFullJSON.json](PackingFullJSON.json) via the low-code editor, then saves.**

Required schema changes:

- [ ] **On the Packing form (header-level):**
  - Add number field `selected_hu_index` (hidden; stores 0-based index of currently-selected `table_hu` row; default -1)

- [ ] **On `table_hu` rows:**
  - Add string field `hu_row_type` (hidden; values `"generated"` or `"locked"`)
  - Add radio/checkbox column bound to selection (platform's native single-select mechanism — exact field depends on platform; confirm during editor setup)
  - Confirm existing columns used by the flow are present: `handling_unit_id`, `handling_no`, `hu_material_id`, `hu_type`, `hu_uom`, `storage_location`, `temp_data`, `item_count`, `total_quantity`

- [ ] **On `table_item_source` rows:**
  - Add number field `picked_qty` (read-only display; default 0)
  - Add number field `remaining_qty` (read-only display)
  - Add editable number field `qty_to_pick` (default = `total_quantity`)
  - Add string field `line_status` (display; values `"Open"` / `"Partially Picked"` / `"Fully Picked"`)
  - Add action-column button `Pick to HU` (emits `onClick` event wired to `PackingOnPickItem`)

- [ ] **On `table_hu_source` rows:**
  - Add action-column button `Pick to HU` (emits `onClick` wired to `PackingOnPickHU`; disabled when row's `hu_status == "Picked"`)

- [ ] **Wire events:**
  - `table_hu` onAdd → `PackingOnAddHU`
  - `table_hu` onRowSelect (or equivalent radio/checkbox change) → `PackingOnSelectHU`
  - `table_hu` onDelete → `PackingOnDeleteHU`
  - `table_item_source` `qty_to_pick` onChange → `PackingOnChangeQtyToPick`
  - Form onMounted → `PackingOnMounted` (existing slot)

- [ ] **Save [PackingFullJSON.json](PackingFullJSON.json).** Subsequent tasks reference field keys from the updated file.

**Verification:** Open [PackingFullJSON.json](PackingFullJSON.json) in an editor. Grep for each new model name: `selected_hu_index`, `hu_row_type`, `picked_qty`, `remaining_qty`, `qty_to_pick`, `line_status`. All should appear exactly once per scope.

---

## Task 2: PackingRecomputeSource.js (shared helper)

**Files:** Create `Packing/PackingRecomputeSource.js`

Pure computation: re-derives `picked_qty` / `remaining_qty` / `line_status` / clamps `qty_to_pick` for every `table_item_source` row based on all `table_hu` rows' `temp_data`. Called after every pick/unpack and on form mount. Does NOT write to the DB; only rewrites the in-memory form state via `this.setData`.

- [ ] **Step 1: Write the handler**

```javascript
// Packing/PackingRecomputeSource.js
// Recomputes table_item_source row state as a projection of all table_hu temp_data.
// Call after every Pick / Delete / onMounted.

(async () => {
  try {
    const tableHu = this.getValue("table_hu") || [];
    const tableItemSource = this.getValue("table_item_source") || [];

    // Sum picked qty per source row id across all target HUs' temp_data
    const pickedByLine = {};
    for (const hu of tableHu) {
      const entries = JSON.parse(hu.temp_data || "[]");
      for (const entry of entries) {
        const key = entry.line_item_id;
        if (!key) continue;
        pickedByLine[key] = (pickedByLine[key] || 0) + (Number(entry.total_quantity) || 0);
      }
    }

    // Apply to each source row
    for (let i = 0; i < tableItemSource.length; i++) {
      const row = tableItemSource[i];
      const total = Number(row.total_quantity) || 0;
      const picked = pickedByLine[row.id] || 0;
      const remaining = Math.max(0, total - picked);

      const status =
        picked === 0 ? "Open" :
        picked < total ? "Partially Picked" :
        "Fully Picked";

      // Clamp user-edited qty_to_pick; fall back to remaining if unset or over cap
      const currentQtyToPick = Number(row.qty_to_pick);
      const newQtyToPick =
        Number.isFinite(currentQtyToPick) && currentQtyToPick > 0 && currentQtyToPick <= remaining
          ? currentQtyToPick
          : remaining;

      await this.setData({
        [`table_item_source.${i}.picked_qty`]: picked,
        [`table_item_source.${i}.remaining_qty`]: remaining,
        [`table_item_source.${i}.qty_to_pick`]: newQtyToPick,
        [`table_item_source.${i}.line_status`]: status,
      });
    }
  } catch (err) {
    console.error("PackingRecomputeSource error:", err);
    this.$message.error(err.message || String(err));
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add Packing/PackingRecomputeSource.js
git commit -m "feat(packing): add source-row derive-live recompute helper"
```

- [ ] **Step 3: Verify (manual, in platform)**

User imports this handler into the platform as a callable function. It will be called by other handlers in later tasks; nothing to test standalone yet.

---

## Task 3: PackingOnPickItem.js (Flow A)

**Files:** Create `Packing/PackingOnPickItem.js`

Triggered by per-row `Pick to HU` button in `table_item_source`. Appends a new entry to the selected target HU's `temp_data`, then recomputes source rows + target HU rollups.

- [ ] **Step 1: Write the handler**

```javascript
// Packing/PackingOnPickItem.js
// Flow A: Pick one source item row into the currently-selected target HU.

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const data = this.getValues();
    const sourceRow = data.table_item_source[rowIndex];
    const selectedHuIndex = Number(data.selected_hu_index);

    // Preconditions
    if (!Number.isFinite(selectedHuIndex) || selectedHuIndex < 0) {
      this.$message.warning("Please select a target HU in the packing table first.");
      return;
    }
    const targetHu = data.table_hu[selectedHuIndex];
    if (!targetHu) {
      this.$message.warning("Selected target HU not found.");
      return;
    }
    if (targetHu.hu_row_type !== "generated") {
      this.$message.warning("Cannot pick into a locked HU. Select a generated HU or add a new one.");
      return;
    }

    const qtyToPick = Number(sourceRow.qty_to_pick) || 0;
    const remaining = Number(sourceRow.remaining_qty) || 0;
    if (qtyToPick <= 0) {
      this.$message.warning("Quantity to pick must be greater than zero.");
      return;
    }
    if (qtyToPick > remaining) {
      this.$message.warning(`Quantity (${qtyToPick}) exceeds remaining (${remaining}).`);
      return;
    }

    // Build temp_data entry from source row
    const existing = JSON.parse(targetHu.temp_data || "[]");
    const entry = {
      line_index: existing.length,
      line_item_id: sourceRow.id,
      balance_id: sourceRow.balance_id,
      item_id: sourceRow.item_id,
      item_code: sourceRow.item_code,
      item_name: sourceRow.item_name,
      item_desc: sourceRow.item_desc,
      item_uom: sourceRow.item_uom,
      batch_no: sourceRow.batch_no,
      source_bin_id: sourceRow.source_bin_id,
      total_quantity: qtyToPick,
      so_id: sourceRow.so_id,
      so_no: sourceRow.so_no,
      so_line_id: sourceRow.so_line_id,
      gd_id: sourceRow.gd_id,
      gd_no: sourceRow.gd_no,
      gd_line_id: sourceRow.gd_line_id,
      to_id: sourceRow.to_id,
      to_no: sourceRow.to_no,
      to_line_id: sourceRow.to_line_id,
    };
    existing.push(entry);

    // Persist temp_data + rollups on target HU
    const distinctItemIds = new Set(existing.map((e) => e.item_id));
    const totalQty = existing.reduce((s, e) => s + (Number(e.total_quantity) || 0), 0);

    await this.setData({
      [`table_hu.${selectedHuIndex}.temp_data`]: JSON.stringify(existing),
      [`table_hu.${selectedHuIndex}.item_count`]: distinctItemIds.size,
      [`table_hu.${selectedHuIndex}.total_quantity`]: totalQty,
    });

    // Recompute source rows (derive-live)
    await this.triggerEvent("PackingRecomputeSource");

    this.$message.success(`Picked ${qtyToPick} to HU ${targetHu.handling_no || selectedHuIndex + 1}.`);
  } catch (err) {
    console.error("PackingOnPickItem error:", err);
    this.$message.error(err.message || String(err));
  }
})();
```

> **Note:** `this.triggerEvent("PackingRecomputeSource")` assumes the low-code platform supports calling another registered event handler by name. If not, inline the body of `PackingRecomputeSource.js` here (DRY-violating but platform-constrained). Confirm during Task 1 setup.

- [ ] **Step 2: Commit**

```bash
git add Packing/PackingOnPickItem.js
git commit -m "feat(packing): add Pick to HU handler for item source (Flow A)"
```

- [ ] **Step 3: Verify in platform**

1. Open a Packing form with source lines loaded.
2. Add a new HU row (Task 5 handler); select it.
3. On an item-source row, ensure `qty_to_pick` defaults to `total_quantity`.
4. Click Pick to HU. Expect: `item_count` and `total_quantity` on target HU update; source `picked_qty` increases, `remaining_qty` decreases, `line_status` flips to "Partially Picked" (or "Fully Picked" if full).
5. Click Pick to HU again without a target selected → warning toast, no-op.

---

## Task 4: PackingOnPickHU.js (Flow B)

**Files:** Create `Packing/PackingOnPickHU.js`

Triggered by per-row `Pick to HU` button in `table_hu_source`. Appends a new Locked row to `table_hu` with the entire source HU's items serialized into its `temp_data`.

- [ ] **Step 1: Write the handler**

```javascript
// Packing/PackingOnPickHU.js
// Flow B: Pick an entire existing HU from source into table_hu as a locked row.

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const data = this.getValues();
    const sourceHu = data.table_hu_source[rowIndex];

    if (!sourceHu) {
      this.$message.warning("Source HU row not found.");
      return;
    }
    if (sourceHu.hu_status === "Picked") {
      this.$message.warning("This HU has already been picked.");
      return;
    }

    // Fetch child items of this source HU from whichever collection holds them.
    // NOTE: the exact collection depends on how table_hu_source is populated on mount.
    // Common pattern: items live inline as sourceHu.children, or in a separate lookup.
    // Adjust to match the loader used in PackingOnMounted.js.
    const children = Array.isArray(sourceHu.children) ? sourceHu.children : [];

    const tempDataEntries = children.map((child, idx) => ({
      line_index: idx,
      line_item_id: child.id,
      balance_id: child.balance_id,
      item_id: child.item_id,
      item_code: child.item_code,
      item_name: child.item_name,
      item_desc: child.item_desc,
      item_uom: child.item_uom,
      batch_no: child.batch_no,
      source_bin_id: child.source_bin_id,
      total_quantity: Number(child.total_quantity) || 0,
      so_id: child.so_id, so_no: child.so_no, so_line_id: child.so_line_id,
      gd_id: child.gd_id, gd_no: child.gd_no, gd_line_id: child.gd_line_id,
      to_id: child.to_id, to_no: child.to_no, to_line_id: child.to_line_id,
    }));

    const distinctItemIds = new Set(tempDataEntries.map((e) => e.item_id));
    const totalQty = tempDataEntries.reduce((s, e) => s + e.total_quantity, 0);

    // Build new locked row
    const tableHu = data.table_hu || [];
    const newRow = {
      hu_row_type: "locked",
      handling_unit_id: sourceHu.handling_unit_id,
      handling_no: sourceHu.handling_no,
      hu_material_id: sourceHu.hu_material_id,
      hu_type: sourceHu.hu_type,
      hu_uom: sourceHu.hu_uom,
      storage_location: sourceHu.storage_location,
      gross_weight: sourceHu.gross_weight,
      net_weight: sourceHu.net_weight,
      net_volume: sourceHu.net_volume,
      hu_status: "Packed",
      temp_data: JSON.stringify(tempDataEntries),
      item_count: distinctItemIds.size,
      total_quantity: totalQty,
      source_hu_row_index: rowIndex, // for reverse lookup on delete
    };

    // Append + flip source status
    await this.setData({
      [`table_hu.${tableHu.length}`]: newRow,
      [`table_hu_source.${rowIndex}.hu_status`]: "Picked",
    });

    this.$message.success(`HU ${sourceHu.handling_no} added as locked row.`);
  } catch (err) {
    console.error("PackingOnPickHU error:", err);
    this.$message.error(err.message || String(err));
  }
})();
```

> **Open item:** The `sourceHu.children` assumption must be confirmed against the actual `table_hu_source` loader. If children live in a separate `handling_unit_line` collection, this handler must fetch them with `db.collection("handling_unit_line").where({ hu_id: sourceHu.id }).get()`.

- [ ] **Step 2: Commit**

```bash
git add Packing/PackingOnPickHU.js
git commit -m "feat(packing): add Pick HU handler for hu source (Flow B)"
```

- [ ] **Step 3: Verify in platform**

1. On a `table_hu_source` row, click Pick to HU.
2. Expect: new row appears in `table_hu` with all fields disabled, `handling_no` + `hu_material_id` copied from source, `temp_data` populated, `item_count`/`total_quantity` rolled up, source row `hu_status = "Picked"`.
3. Second click on the same source row → warning toast, no-op.

---

## Task 5: PackingOnAddHU.js

**Files:** Create `Packing/PackingOnAddHU.js`

Fires when user clicks Add on `table_hu`. Initializes a Generated row and triggers `handling_no` auto-generation (the platform's prefix/workflow mechanism — reference [Goods Receiving/GRworkflow.json](../Goods%20Receiving/GRworkflow.json) for the GR `handling_no` generation pattern).

- [ ] **Step 1: Write the handler**

```javascript
// Packing/PackingOnAddHU.js
// Initializes a newly-added table_hu row as a Generated HU.

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;

    await this.setData({
      [`table_hu.${rowIndex}.hu_row_type`]: "generated",
      [`table_hu.${rowIndex}.temp_data`]: "[]",
      [`table_hu.${rowIndex}.item_count`]: 0,
      [`table_hu.${rowIndex}.total_quantity`]: 0,
      [`table_hu.${rowIndex}.hu_status`]: "Unpacked",
    });

    // handling_no generation:
    // If the platform supports client-side prefix fetch, resolve + set here.
    // Otherwise, leave blank and rely on the backend workflow to fill it on save (GR pattern).
    // Confirm with user during Task 1 setup and remove this comment once wired.
  } catch (err) {
    console.error("PackingOnAddHU error:", err);
    this.$message.error(err.message || String(err));
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add Packing/PackingOnAddHU.js
git commit -m "feat(packing): add new-HU-row handler for generated rows"
```

- [ ] **Step 3: Verify in platform**

1. Click Add on `table_hu`. Expect: new row with `hu_row_type = "generated"`, empty `temp_data` (not null), `item_count = 0`, `total_quantity = 0`. Fields editable.

---

## Task 6: PackingOnSelectHU.js

**Files:** Create `Packing/PackingOnSelectHU.js`

Writes the selected row's index to the header field `selected_hu_index`. If the platform's radio/checkbox is natively single-select, this handler just stores the index. If it's multi-select, it must enforce single-select by clearing other rows' selection flag.

- [ ] **Step 1: Write the handler**

```javascript
// Packing/PackingOnSelectHU.js
// Single-select enforcement + store selected index on header.
// Event args: { rowIndex, selected } — adjust to match platform's actual event payload.

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const selected = arguments[0].selected !== false; // default true if not provided

    if (!selected) {
      // Row was deselected
      const current = Number(this.getValue("selected_hu_index"));
      if (current === rowIndex) {
        await this.setData({ selected_hu_index: -1 });
      }
      return;
    }

    // Selecting this row — clear others if platform doesn't enforce single-select
    const tableHu = this.getValue("table_hu") || [];
    const updates = { selected_hu_index: rowIndex };
    for (let i = 0; i < tableHu.length; i++) {
      if (i !== rowIndex) {
        updates[`table_hu.${i}.select_hu`] = false; // field key from editor; adjust if different
      }
    }
    await this.setData(updates);
  } catch (err) {
    console.error("PackingOnSelectHU error:", err);
    this.$message.error(err.message || String(err));
  }
})();
```

> **Open item:** `select_hu` is the existing select-column field from [PackingFullJSON.json:2623](PackingFullJSON.json). Confirm the exact model name during Task 1. If platform supports native single-select, drop the clear-others loop.

- [ ] **Step 2: Commit**

```bash
git add Packing/PackingOnSelectHU.js
git commit -m "feat(packing): add target HU selection handler"
```

- [ ] **Step 3: Verify in platform**

1. Select a row in `table_hu`. Expect: `selected_hu_index` updates; other rows' select flag clears.
2. Select a different row. Expect: first row clears, second row wins, `selected_hu_index` changes.
3. Deselect. Expect: `selected_hu_index = -1`.

---

## Task 7: PackingOnDeleteHU.js

**Files:** Create `Packing/PackingOnDeleteHU.js`

Delete-row on `table_hu`. Two paths depending on `hu_row_type`: clear all `temp_data` for Generated; restore source HU state for Locked. After either, call recompute.

- [ ] **Step 1: Write the handler**

```javascript
// Packing/PackingOnDeleteHU.js
// Delete-row handler for table_hu. Restores source-row state before row removal.

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const data = this.getValues();
    const deletingRow = data.table_hu[rowIndex];

    if (!deletingRow) return;

    if (deletingRow.hu_row_type === "locked") {
      // Restore the source HU in table_hu_source to selectable
      const sourceIndex = deletingRow.source_hu_row_index;
      if (Number.isFinite(sourceIndex) && sourceIndex >= 0) {
        await this.setData({
          [`table_hu_source.${sourceIndex}.hu_status`]: "Unpacked",
        });
      }
    }
    // For Generated rows: temp_data will be gone with the row; recompute picks up the change.

    // Clear selection if we just deleted the selected row
    const selectedHuIndex = Number(this.getValue("selected_hu_index"));
    if (selectedHuIndex === rowIndex) {
      await this.setData({ selected_hu_index: -1 });
    } else if (selectedHuIndex > rowIndex) {
      // Indices shift left after delete
      await this.setData({ selected_hu_index: selectedHuIndex - 1 });
    }

    // Platform removes the row itself (onDelete event is post-removal in most platforms).
    // If this platform fires pre-removal, splice table_hu here instead.

    await this.triggerEvent("PackingRecomputeSource");
  } catch (err) {
    console.error("PackingOnDeleteHU error:", err);
    this.$message.error(err.message || String(err));
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add Packing/PackingOnDeleteHU.js
git commit -m "feat(packing): add delete-row handler restoring source state"
```

- [ ] **Step 3: Verify in platform**

1. **Generated row:** Pick a few items into a Generated HU; delete the row. Expect: source rows revert (picked_qty decreases by the amounts; `line_status` flips back; `remaining_qty` restored).
2. **Locked row:** Pick an HU via Flow B; delete the Locked row. Expect: source HU `hu_status` reverts to "Unpacked", Pick to HU button re-enables.
3. **Selection shift:** Select HU at index 2, delete HU at index 0. Expect: `selected_hu_index` becomes 1 (selection follows the same row).

---

## Task 8: PackingOnChangeQtyToPick.js

**Files:** Create `Packing/PackingOnChangeQtyToPick.js`

Clamps user-entered `qty_to_pick` on a `table_item_source` row so it never exceeds `remaining_qty` or goes below 0.

- [ ] **Step 1: Write the handler**

```javascript
// Packing/PackingOnChangeQtyToPick.js
// Clamp qty_to_pick to [0, remaining_qty] on edit.

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const row = this.getValue(`table_item_source.${rowIndex}`);
    if (!row) return;

    const remaining = Number(row.remaining_qty) || 0;
    let value = Number(row.qty_to_pick);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > remaining) value = remaining;

    if (Number(row.qty_to_pick) !== value) {
      await this.setData({ [`table_item_source.${rowIndex}.qty_to_pick`]: value });
      this.$message.warning(`Quantity clamped to remaining (${remaining}).`);
    }
  } catch (err) {
    console.error("PackingOnChangeQtyToPick error:", err);
  }
})();
```

- [ ] **Step 2: Commit**

```bash
git add Packing/PackingOnChangeQtyToPick.js
git commit -m "feat(packing): clamp qty_to_pick on edit"
```

- [ ] **Step 3: Verify in platform**

1. On a source row with `remaining_qty = 5`, type `qty_to_pick = 99`. Expect: value resets to 5, warning toast.
2. Type `-3`. Expect: value resets to 0.
3. Type `3`. Expect: value stays at 3.

---

## Task 9: Update PackingOnMounted.js

**Files:** Modify `Packing/PackingOnMounted.js`

At the end of the existing mount logic (after source tables are populated), call `PackingRecomputeSource` so loaded `temp_data` projects onto source rows.

- [ ] **Step 1: Read the existing handler to know where to append**

(Read `Packing/PackingOnMounted.js` and locate the end of the main async IIFE.)

- [ ] **Step 2: Append the recompute call**

At the end of the main async block, before the final `})();`:

```javascript
    // Project loaded temp_data onto source rows (derive-live state)
    await this.triggerEvent("PackingRecomputeSource");
```

- [ ] **Step 3: Commit**

```bash
git add Packing/PackingOnMounted.js
git commit -m "feat(packing): recompute source rows after mount"
```

- [ ] **Step 4: Verify in platform**

1. Create a Packing document, pick items into HUs, save.
2. Reload the document. Expect: source rows show the correct `picked_qty` / `remaining_qty` / `line_status` matching the saved `temp_data` (not a fresh Open state).

---

## Task 10: End-to-end platform verification

- [ ] **Step 1:** Run through every scenario from the design spec's Section 8:

1. Open Packing form with SO/GD/TO source lines loaded → source rows show `line_status = "Open"`, `qty_to_pick == total_quantity`.
2. **Flow A:** Add HU, select it, edit `qty_to_pick = 3` on a source row with total 10, click Pick to HU. Verify: source `picked_qty = 3`, `remaining_qty = 7`, `line_status = "Partially Picked"`; target `item_count = 1`, `total_quantity = 3`.
3. **Split across HUs:** Add HU #2, select it, pick 2 more from the same source row. Verify: source `remaining_qty = 5`; both target HUs hold their own entries.
4. **Flow B:** On a `table_hu_source` row, click Pick to HU. Verify: new Locked row in `table_hu`, all fields disabled, source HU `hu_status = "Picked"`.
5. **Unpack Locked:** Delete the Locked row. Verify: source HU reverts to "Unpacked", Pick button re-enables.
6. **Unpack Generated:** Delete a Generated row. Verify: its `temp_data` clears, all source rows it touched recompute.
7. **Precondition violations:**
   - Pick to HU on item source with no target selected → warning toast, no-op.
   - Select a Locked row, pick an item source → warning toast, no-op.
8. **Save + reload:** Save, reload. Verify: `table_hu` restored with `temp_data` intact; source rows show correct state after `PackingOnMounted` recompute.

- [ ] **Step 2: Commit any post-verification fixes**

```bash
git commit -m "fix(packing): <issues found during e2e verification>"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** every design section has a task — Data Model (Task 1), Flow A (Task 3), Flow B (Task 4), Unpack (Task 7), Rollups (in Task 3/4), Selection (Task 6), Persistence (relies on platform save — confirmed no change needed in this plan), Derive-live recompute (Task 2 + Task 9).
- [x] **Placeholder scan:** no TBDs. Open items are flagged explicitly with "Open item:" notes tied to Task 1 setup.
- [x] **Type consistency:** `hu_row_type` ("generated" / "locked") used identically across Tasks 3, 4, 5, 7. `temp_data` entry shape identical across Tasks 3, 4. `selected_hu_index` semantics consistent across Tasks 3, 6, 7.
- [x] **No dead refs:** every function/field named in a task is defined in that task or an earlier one.
