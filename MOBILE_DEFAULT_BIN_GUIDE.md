# Mobile Implementation Guide — Item Master Default Bin Auto-Fill

**Audience:** Mobile client developers
**Scope:** Goods Receiving (GR), Misc Receipt (MSR), Location Transfer (LOT), Plant Transfer Receiving (PT), Sales Return Receiving (SRR)
**Status:** Web clients updated across all five modules (8 files). Mobile needs the matching client change.
**Type:** Client-side form change only — no schema change, no workflow change.

---

## Background / Why

The Item master carries a per-plant **fixed bin** in the `table_default_bin` subform. Until now only Putaway's `FIXED BIN` strategy read it; every receiving and target-location auto-fill ignored it and stamped the **plant-level** default bin instead.

Desktop now prefers the item's own bin wherever a line's location is auto-filled, falling back to the plant default when the item has no entry for that plant.

This is not a cosmetic divergence. Until mobile matches, the *same document* created on the two clients puts stock in **different physical bins**, and the resulting `item_balance` rows are keyed by location — so the divergence is permanent and shows up later as stock that pickers cannot find where they expect it.

The data already exists on the Item record. Nothing needs to be added server-side.

---

## Table of Contents

1. [Mental Model](#1-mental-model)
2. [Four Traps — read before writing any code](#2-four-traps--read-before-writing-any-code)
3. [Per-Module Field Mapping](#3-per-module-field-mapping)
4. [The Helper (verbatim)](#4-the-helper-verbatim)
5. [Three Touch Points](#5-three-touch-points)
6. [The Two Modules That Don't Fit The Pattern](#6-the-two-modules-that-dont-fit-the-pattern)
7. [Fetch-Cost Rules](#7-fetch-cost-rules)
8. [Edge-Case / Test Matrix](#8-edge-case--test-matrix)
9. [Mobile Porting Checklist](#9-mobile-porting-checklist)
10. [Open Items](#10-open-items)

---

## 1. Mental Model

`table_default_bin` is an **array column directly on the Item record**. A fetch of the Item returns it inline, so reading it is **one Item fetch, never a join** — the same shape as `table_cust_item_bind` (see `MOBILE_ITEM_DESC_BINDING_GUIDE.md`).

```jsonc
// an Item record, abridged
{
  "id": "1901546842240438273",
  "material_name": "Blue Widget 20mm",
  "table_default_bin": [
    { "plant_id": "<plant A id>",
      "storage_location": "<storage location id>",
      "bin_location": "<bin location id>" },
    { "plant_id": "<plant B id>",
      "storage_location": "<storage location id>",
      "bin_location": "<bin location id>" }
  ]
}
```

**Column definitions on the Item form** (`Item/ItemFullJSON.json`):

| Column | Type | Datasource | Required |
|---|---|---|---|
| `plant_id` | treeselect | 组织机构 (organization) | **No** |
| `storage_location` | select | `Storage Location:Table:1986694920453566466` | **No** |
| `bin_location` | select | `Bin Location:Table:1902282127538507778` | **No** |

None of the three is required. **Partial rows are legal and you will meet them in production.** That fact drives Trap 2.

**Resolution order:**

1. If there is no plant in context, stop — return nothing and use the plant default.
2. Walk `table_default_bin` **in array order**.
3. Keep rows whose `plant_id` matches the plant in context **and** whose `bin_location` is non-blank.
4. Return the **first** such row as a `{ binLocation, storageLocation }` **pair**.
5. If none qualifies, return nothing — the caller uses the existing plant-level default, unchanged.

**Precondition:** mobile's existing plant-level default bin resolution is assumed correct and is not re-specified here. The item default is a **layer on top** of it; the fallback path must behave exactly as it does today.

---

## 2. Four Traps — read before writing any code

### Trap 1 — The plant field has three different names, and one of them is a lie

| Module | Field holding the plant |
|---|---|
| GR | `plant_id` |
| SRR | `plant_id` |
| MSR | `issuing_operation_faci` |
| LOT | `issuing_operation_faci` |
| PT receiving | `issuing_operation_faci` — **which holds the *receiving* plant** |

The PT case is the nasty one. On a **Plant Transfer (Receiving)** child document, `issuing_operation_faci` does **not** hold the issuing plant. The save workflow writes the child's `issuing_operation_faci` from the parent's `receiving_operation_faci`:

```jsonc
// PTsaveWorkflowChangeFlow.json — receiving-child creation
{ "prop": "issuing_operation_faci",
  "value": "{{node:code_node_37LA0tgq.data.allData.receiving_operation_faci}}",
  "propLabel": "Plant" }        // <- note the label: it is the document's OWN plant
```

So on a receiving child, `issuing_operation_faci` **is** the receiving plant, and it is the correct field to match `table_default_bin` against. This is also the value the form's existing `setStorageLocation()` already uses, so you are consistent with the plant default that is resolved beside it.

> Do **not** "fix" this by switching to `receiving_operation_faci` on the child. That field is also populated (with the same value on a first-generation child), but the leftover-child path copies `issuing_operation_faci` forward, and matching on the wrong one drifts apart across partial receipts.

**Every way of getting the plant wrong fails silently.** The lookup simply never matches, you fall back to the plant default, and nothing throws. There is no error to grep for — only stock in the wrong bin, discovered weeks later.

### Trap 2 — A row with a blank `bin_location` must be ignored, not used

Because all three columns are optional, a row can carry a plant and a storage location but no bin. **That row is unconfigured. Skip it and fall back.**

Do not do what Putaway's `FIXED BIN` strategy does:

```js
// Putaway/PutawayGetStrategy.js — do NOT copy this shape
const matchingBin = itemData.table_default_bin.find(
  (bin) => bin.plant_id === plantId,     // no bin_location check
);
if (matchingBin) {
  target_location: matchingBin.bin_location,   // may be undefined
}
```

A null `location_id` reaching `ADD_INVENTORY` is a known, documented failure mode: the receipt is written to a **brand-new binless `item_balance` row that no bin-scoped query can find** — and because `location_id = NULL` never satisfies `=`, that row can never be matched or reused either, so every subsequent blank receipt spawns another orphan. The PT save workflow carries two separate layers of defence against exactly this.

Filter on `bin.plant_id === plantId && bin.bin_location` and the problem cannot occur.

### Trap 3 — Storage and bin move together

A bin belongs to exactly one storage location. The item-master row records both side by side for that reason.

**Never pair an item-master bin with a storage location from somewhere else** unless the row genuinely has no storage location of its own (then, and only then, fall back to the plant default storage location).

Practical consequence, applied on every module: a line is either given the **complete pair** or is left for the plant-default path. A line must never end up holding a bin with no storage location behind it, or a bin that does not sit under the storage location beside it.

### Trap 4 — The stale bin on item change

On a per-row item change, **always overwrite** the location fields.

This was harmless before: the value in the field could only ever *be* the plant default, so leaving it alone and leaving it set were the same thing. With item-specific bins that is no longer true.

Failure sequence:

1. Plant has no default bin configured (or the row was cleared).
2. User picks item **A**, which has a default bin at this plant → row gets **A's bin**.
3. User changes the row's item to **B**, which has no entry for this plant.
4. Under "only set when a default exists", the row keeps **A's bin** — and receives B's stock into a bin configured for A.

Write the resolved value unconditionally (empty string when nothing resolves), so the location is always recomputed from the item currently on the row.

---

## 3. Per-Module Field Mapping

| Module | Web file | Plant field | Line array | Bin key | Storage key | Item record comes from |
|---|---|---|---|---|---|---|
| GR — batch add | `Goods Receiving/GRaddBatchLineItem.js` | `plant_id` | `table_gr` | `location_id` | `storage_location_id` | *Document* ref: `fetchItemData(poItem.item_id)`.<br>*Item* ref: dialog row `poItem.item`, batched fallback |
| GR — process line | `Goods Receiving/GRprocessGRLineItem.js` | `plant_id` | `table_gr` | `location_id` | `storage_location_id` | `fetchItemData(item.item_id)` |
| MSR — item change | `Stock Movement/Misc Receipt/MSRonChangeItem.js` | `issuing_operation_faci` | `stock_movement` | `location_id` | `storage_location_id` | `arguments[0].fieldModel.item` |
| MSR — batch add | `Stock Movement/Misc Receipt/MSRbatchAddLineItem.js` | `issuing_operation_faci` | `stock_movement` | `location_id` | `storage_location_id` | `arguments[0].itemArray` entries |
| LOT — item change | `Stock Movement/Location Transfer/LOTonChangeItem.js` | `issuing_operation_faci` | `stock_movement` | `location_id` | `storage_location_id` | `arguments[0].fieldModel.item` |
| LOT — batch add | `Stock Movement/Location Transfer/LOTbatchAddLineItem.js` | `issuing_operation_faci` | `stock_movement` | `location_id` | `storage_location_id` | `arguments[0].itemArray` entries |
| PT — receiving open | `Stock Movement/Plant Transfer/PTonMounted.js` | `issuing_operation_faci` **(= receiving plant)** | `stock_movement` | `location_id` | `storage_location_id` | batched fetch keyed on `row.item_selection` |
| SRR — batch add | `Sales Return Receiving/SRRbatchAddLineItem.js` | `plant_id` | `table_srr` | `location_id` | `storage_location_id` *(see §6)* | *Document* ref: `fetchItemData(srItem.material_id)`.<br>*Item* ref: dialog row `srItem.item`, batched fallback |

**Where the existing plant default lives per module** — these are the values your fallback path already uses; the guide does not change them:

| Module | Plant default bin | Plant default storage |
|---|---|---|
| GR | `predefined_data[0].defaultBinLocation` | `predefined_data[0].defaultStorageLocation` |
| MSR / LOT / PT | `default_bin` (header) | `default_storage_location` (header) |
| SRR | `default_bin_location` (header) | *not read by this path — see §6* |

**Item-record projections.** Where the web client fetches the Item with a `.field()` projection, `table_default_bin` had to be added to the list or the column comes back absent (not empty — absent):

```js
// Goods Receiving/GRaddBatchLineItem.js and GRprocessGRLineItem.js
.field("receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method,item_category,serial_number_management,table_uom_conversion,based_uom,formula,table_default_bin")

// Sales Return Receiving/SRRbatchAddLineItem.js
.field("item_batch_management,batch_number_genaration,table_default_bin")
```

If mobile projects fields on its Item fetches, **check every projection** in the five modules. A missing key here is another silent fallback.

---

## 4. The Helper (verbatim)

One function, identical in all eight web files. Port it once.

```js
// Item master default bin for this plant. Takes priority over the plant-level
// default; a row without a bin is treated as unconfigured so we never stamp a
// blank bin on the line.
const getItemDefaultBin = (tableDefaultBin, plantId) => {
  if (!plantId || !Array.isArray(tableDefaultBin)) return null;

  const matchingBin = tableDefaultBin.find(
    (bin) => bin.plant_id === plantId && bin.bin_location,
  );

  if (!matchingBin) return null;

  return {
    binLocation: matchingBin.bin_location,
    storageLocation: matchingBin.storage_location || null,
  };
};
```

Notes on the three guards, each of which matters:

- `!plantId` — no plant in context means no row can match. Returning early also lets callers skip the Item lookup entirely (see §7).
- `!Array.isArray(...)` — covers both "item has no bins" (`[]`) and "the column was never returned" (`undefined`, e.g. a projection that omits it). Both fall back; neither throws.
- `&& bin.bin_location` — Trap 2. This is the whole defence against the binless-orphan row.

`storageLocation` is deliberately `null` rather than `undefined` when the row has a bin but no storage location, so callers can write `itemDefaultBin.storageLocation || plantDefaultStorage` without a nested optional chain.

---

## 5. Three Touch Points

### 5a. Per-row item change (MSR, LOT)

The item record is already in hand as `arguments[0].fieldModel.item` — **no fetch**. Overwrite unconditionally (Trap 4):

```js
const handleBinLocation = (
  itemData,
  plantId,
  defaultBin,
  defaultStorageLocation,
  rowIndex,
) => {
  const itemDefaultBin = getItemDefaultBin(itemData?.table_default_bin, plantId);

  // Always overwrite: the row may still carry the previously selected item's bin.
  this.setData({
    [`stock_movement.${rowIndex}.location_id`]:
      itemDefaultBin?.binLocation || defaultBin || "",
    [`stock_movement.${rowIndex}.storage_location_id`]:
      itemDefaultBin?.storageLocation || defaultStorageLocation || "",
  });

  this.disabled(`stock_movement.${rowIndex}.location_id`, false);
  this.disabled(`stock_movement.${rowIndex}.storage_location_id`, false);
};
```

Plant comes from `this.getValues().issuing_operation_faci`.

### 5b. Batch / dialog multi-add (MSR, LOT, GR, SRR)

Rows are brand new, so there is no stale value to defeat — but keep the pair rule (Trap 3): only write when a complete pair resolves.

```js
const handleBinLocation = (
  plantId,
  defaultBin,
  defaultStorageLocation,
  currentItemArray,
  smLineItem,
) => {
  for (const [index, item] of currentItemArray.entries()) {
    const rowIndex = smLineItem.length + index;

    const itemDefaultBin = getItemDefaultBin(item.table_default_bin, plantId);

    const binLocation = itemDefaultBin?.binLocation || defaultBin;
    const storageLocation =
      itemDefaultBin?.storageLocation || defaultStorageLocation;

    if (binLocation && storageLocation) {
      this.setData({
        [`stock_movement.${rowIndex}.location_id`]: binLocation,
        [`stock_movement.${rowIndex}.storage_location_id`]: storageLocation,
      });
    }

    this.disabled(`stock_movement.${rowIndex}.location_id`, false);
    this.disabled(`stock_movement.${rowIndex}.storage_location_id`, false);
  }
};
```

For GR and SRR the same resolution happens inline while the line record is being built, because those modules construct the whole row object rather than patching it afterwards:

```js
storage_location_id:
  itemDefaultBin?.storageLocation || defaultStorageLocationID,
location_id: itemDefaultBin?.binLocation || defaultBinLocationID,
```

### 5c. Pre-built rows on document open (PT only)

See §6.

---

## 6. The Two Modules That Don't Fit The Pattern

### PT receiving — rows already exist, and the bin is a *move*, not a placement

Three things are different here.

**(1) The rows arrive pre-built.** A receiving child is created by the save workflow from the issuing document; the receiver opens it with lines already populated. So the fill runs on document open (`PTonMounted`), not on item change or batch add — and it must **only fill rows whose location is blank**. A receiver who split a line and picked per-row bins has already made a choice; overwriting it loses their work:

```js
// Default only the rows that have no bin yet. The whole-column form of
// this setData overwrites EVERY row, which would wipe the per-row bins a
// user picked when splitting a line and saved.
```

**(2) Both paths are all-or-nothing.** The item path applies only when the row has *neither* field set, and only when a storage location can accompany the bin:

```js
const itemStorageLocation =
  itemDefaultBin?.storageLocation || defaultStorageLocation;

if (
  itemDefaultBin &&
  itemStorageLocation &&
  !row.storage_location_id &&
  !row.location_id
) {
  updates[`stock_movement.${index}.storage_location_id`] = itemStorageLocation;
  updates[`stock_movement.${index}.location_id`] = itemDefaultBin.binLocation;
  return;
}

// Unchanged plant-default path: still all-or-nothing, so a row is never
// left with a bin that has no storage location behind it.
if (!hasPlantDefault) return;
```

A row holding one of the two fields already belongs to a storage location; completing it from the item master could pair a bin with a storage location it does not sit under.

**(3) An item bin ≠ the plant default is a supported receipt-with-move, not a bug.** This is the part worth understanding before you touch PT, because it looks alarming and is not.

At issue time the stock is parked as **In Transit at the receiving plant's default bin**, recorded on `in_transit_detail` as `transit_bin`. At completion the workflow already performs two independent movements:

```js
// PTsaveWorkflowChangeFlow.json — code_node_PTcompCompute
subtracts.push({ ... category: "In Transit", location: receivingBin ... })  // always the plant default
adds.push({ ... category: line.category, location: binOf(line) ... })       // the row's own bin
```

`in_transit_detail` tracks the two separately — `transit_bin` (where it waited) versus `to_bin` (where it landed, `finalBinByKey`). A row bin that differs from the plant default is therefore already a first-class outcome, exercised today whenever a receiver picks a different bin by hand. Pointing the line at the item's default bin only changes the `adds` location; the In Transit release still happens where the stock physically is.

**Do not push this into the workflow.** The workflow's two bin fallbacks (`code_node_37LA0tgq` and `PTcompCompute.binOf`) exist purely as blank-row safety nets for the binless-orphan bug in Trap 2, and their correct answer is the *identity* one — leave the stock where the In Transit already sits. Making a fallback prefer a different bin turns a safety net into a silent stock move. It is also expensive: workflow code-nodes cannot call `db`, so a server-side `table_default_bin` lookup means a new Item node on the hot save path for a value the form already has.

The receiver sees the bin on the form and can override it before confirming. That is the right place for a *preference*; the workflow layers stay *guarantees*.

### SRR — the line only ever wrote `location_id`

`table_srr` has both `storage_location_id` and `location_id` columns, but the batch-add path historically populated **only the bin**; the storage location was left for the user to pick in the grid, and the save workflow just spreads the line into `inventoryData`:

```js
// SRRsaveWorkflow.json — code_node_ensRYKCK "11. Map Inventory Data"
return { inventoryData: { ...srrLineItem, plant_id: entry.plant_id, ... } }
```

To avoid changing behaviour on the untouched path, the web client stamps `storage_location_id` **only when the item master supplies one**, using a conditional spread:

```js
location_id: itemDefaultBin?.binLocation || defaultBinLocation,
// Only stamped when the item master supplies one. This line never
// managed storage_location_id before, and a bin taken from the item
// master belongs to the storage location recorded beside it.
...(itemDefaultBin?.storageLocation
  ? { storage_location_id: itemDefaultBin.storageLocation }
  : {}),
```

The plant-default path stays byte-identical to what it does today: bin only, storage untouched.

---

## 7. Fetch-Cost Rules

The item's `table_default_bin` must never cost a fetch per line. Three cases, in order of preference:

**(a) The record is already in hand — use it, add nothing.**
`arguments[0].fieldModel.item` (per-row selects) and `arguments[0].itemArray` (batch dialogs) are full Item records; they already carry `table_uom_conversion`, which proves array columns are present. MSR and LOT add **zero** database calls.

**(b) A fetch already happens in the loop — widen its projection.**
GR (both files) and SRR's *Document* reference already call `fetchItemData(...)` per line. Adding `table_default_bin` to the `.field()` list costs nothing.

**(c) Nothing is in hand — exactly one batched fetch, never per-line.**

```js
const resItems = await db
  .collection("Item")
  .filter(new Filter().in("id", missingItemIds).build())
  .get();
```

Used in two places:

- **GR and SRR, *Item* reference.** These build lines from dialog rows without fetching. The web client reuses `poItem.item.table_default_bin` / `srItem.item.table_default_bin` when the row exposes it, and batches **only the ids where the property is `undefined`**. Distinguish carefully: `[]` means "item has no default bins" and needs no fetch; `undefined` means "the column was not returned" and does.
- **PT receiving on open.** Rows carry the item id as `row.item_selection`. Collect the distinct ids **of rows that still need a default**, and skip the call entirely when the plant is unknown or every row already has a bin:

```js
const defaultBinByItem = plantId ? await fetchItemDefaultBins(rows) : new Map();
```

---

## 8. Edge-Case / Test Matrix

| # | Setup | Expected |
|---|---|---|
| 1 | Item has a row for the current plant with both `storage_location` and `bin_location` | Line gets the item's bin **and** the item's storage location |
| 2 | Item has rows, but none for the current plant | Plant default, unchanged |
| 3 | Item has `table_default_bin: []` | Plant default, unchanged |
| 4 | `table_default_bin` absent from the response (projection omits it) | Plant default, unchanged — **must not throw** |
| 5 | Row matches the plant, `bin_location` **blank** | Plant default. **Never a blank bin.** (Trap 2) |
| 6 | Row matches the plant, `bin_location` set, `storage_location` **blank** | Item's bin + **plant default** storage location |
| 7 | Two rows for the same plant, first has a blank bin | The **second** row wins (first row with a usable bin) |
| 8 | Row-level item changed from A (has a bin here) to B (has none) | Row shows B's resolution — plant default, **not A's bin** (Trap 4) |
| 9 | No plant selected on the header yet | No item lookup at all; plant-default behaviour unchanged |
| 10 | Plant default missing **and** item has no usable row | Nothing stamped. Never a half-pair (Trap 3) |
| 11 | **PT:** row already carries a bin (receiver split the line) | Row untouched |
| 12 | **PT:** row has a storage location but no bin | Falls to the plant-default path, not the item path |
| 13 | **PT:** confirm the plant used is the **receiving** plant | Match against `issuing_operation_faci` on the child (Trap 1) |
| 14 | **SRR:** item supplies a bin but no storage location | `location_id` set; `storage_location_id` **not** written |
| 15 | Same document built on mobile and on desktop | Identical `location_id` / `storage_location_id` on every line |

Case 15 is the acceptance test for this whole guide. Cases 5, 8 and 13 are the ones that fail silently in production if missed.

---

## 9. Mobile Porting Checklist

- [ ] Port `getItemDefaultBin` once, verbatim, including all three guards.
- [ ] Confirm the plant field per module against §3 — especially **PT = `issuing_operation_faci` on the receiving child**.
- [ ] Audit every Item fetch projection in the five modules for `table_default_bin`.
- [ ] **MSR** — item change (overwrite unconditionally) + batch add (pair rule).
- [ ] **LOT** — item change + batch add. Structurally identical to MSR; `location_id` here is the form's **"Target Location"**.
- [ ] **GR** — both entry points: batch add *and* the process-line path. Both stamp the same two fields from the same predefined data; doing only one leaves the same document filling bins differently depending on which path built the lines.
- [ ] **GR / SRR *Item* reference** — reuse the dialog row's subform, batch only the `undefined` ids.
- [ ] **SRR** — wire `plant_id` in (the web file did not read it before); stamp `storage_location_id` only when the item supplies one.
- [ ] **PT receiving** — on open, blank rows only, all-or-nothing on both paths, one batched fetch, skip when no plant.
- [ ] Verify no per-line Item fetch was introduced anywhere (§7).
- [ ] Run the §8 matrix, then case 15 side-by-side against desktop.

---

## 10. Open Items

**Unverified on-platform:** whether the GR and SRR *Item*-reference dialog rows expose `table_default_bin` on the nested `item` object. Both code paths work either way — the flag only decides whether the batched fallback fetch in §7(c) ever fires. Worth confirming once on the platform so the fetch can be dropped if it is dead weight, or kept knowingly if it is load-bearing.

**Deliberately out of scope:**

- **Putaway** already implements this as its `FIXED BIN` strategy and is unchanged (but note its missing `bin_location` guard, Trap 2 — do not copy it).
- **Outbound flows** (Misc Issue, Goods Delivery, Picking) allocate from existing balance and have no target bin to fill.
- **Repack / Packing** target storage is user-driven per handling unit.
- **The generic Stock Movement form** (`SMbatchAddLineItem.js`, `SMonChangeItem.js`) is superseded by the per-type folders and was intentionally left alone. If mobile still routes Miscellaneous Receipt through a generic form, it needs the §5 treatment too.
