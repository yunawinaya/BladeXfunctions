# Mobile Implementation Guide — Customer / Supplier-Specific Item Descriptions

**Audience:** Mobile client developers
**Scope:** Quotation (SQT), Sales Order (SO), Purchase Requisition (PR), Purchase Order (PO)
**Status:** Web clients already updated across all four modules. Mobile needs the matching client change.

---

## Background / Why

The Item master now lets a trading partner have **their own wording** for an item. Two subforms on the Item record hold these bindings:

- `table_cust_item_bind` — customer-specific descriptions (used by **SQT**, **SO**)
- `table_sup_item_bind` — supplier-specific descriptions (used by **PR**, **PO**)

Today mobile writes the item's generic `material_desc` into every line. Desktop now resolves the partner-specific description instead. Until mobile matches, the *same* document created on the two clients carries different text — and that text propagates: `so_desc` flows into Goods Delivery, Picking Plan and Sales Invoice; `sqt_desc` becomes `so_desc` on quote conversion; `pr_line_material_desc` becomes the PO's `item_desc` on PR conversion.

This is a **client-side form change only**. No workflow or schema work is required — the data already exists on the Item record.

---

## Table of Contents

1. [Mental Model](#1-mental-model)
2. [The Rename Trap — read this before writing any code](#2-the-rename-trap--read-this-before-writing-any-code)
3. [Per-Module Field Mapping](#3-per-module-field-mapping)
4. [The Two Helper Bodies (verbatim)](#4-the-two-helper-bodies-verbatim)
5. [Three Touch Points](#5-three-touch-points)
6. [Rules That Are Not Obvious](#6-rules-that-are-not-obvious)
7. [Edge-Case / Test Matrix](#7-edge-case--test-matrix)
8. [Mobile Porting Checklist](#8-mobile-porting-checklist)

---

## 1. Mental Model

Two bind tables, **one algorithm**.

Both subforms are stored as an **array column directly on the Item record**. Neither has a datasource of its own and there is no `*_sub` collection for either — exactly like `table_uom_conversion`. So reading a binding is always **one Item fetch, never a join**.

A row binds one partner to one description:

```jsonc
// an Item record, abridged
{
  "id": "1901546842240438273",
  "material_desc": "Blue Widget 20mm",          // the generic fallback
  "table_cust_item_bind": [
    { "customer_id": "<Customer id>", "customer_name": "Acme",
      "cust_item_alias": "BW-20",  "item_desc": "Blue widget, 20mm" },
    { "customer_id": "<Customer id>", "customer_name": "Acme",
      "cust_item_alias": "BW-20E", "item_desc": "Blue widget, export packing" }
  ],
  "table_sup_item_bind": [
    { "supplier_id": "<Supplier id>", "supplier_name": "Globex",
      "sup_item_alias": "G-771",   "item_description": "Widget, blue, 20 mm" }
  ]
}
```

**Resolution order:**

1. Walk the bind rows **in array order**.
2. Keep only rows whose party id matches the currently selected partner.
3. Return the **first** such row that has a **non-blank** description.
4. If none qualifies, return the item's own `material_desc`.

> **A partner can legitimately appear on several rows** — that's why the alias column exists (same item, different pack/spec per alias). We take the earliest row; we do not concatenate, and we do not prompt.

The line has exactly one description field, so there is nothing to choose between at the UI level.

---

## 2. The Rename Trap — read this before writing any code

The two families differ by **three** key names, and **every** way of getting them wrong fails *silently*: the lookup simply never matches, you fall back to `material_desc`, and nothing throws.

| | Customer family (SQT, SO) | Supplier family (PR, PO) |
|---|---|---|
| Bind table | `table_cust_item_bind` | `table_sup_item_bind` |
| Row party key | `customer_id` | `supplier_id` |
| Row description key | `item_desc` | **`item_description`** |

The genuinely nasty collision:

> The **customer** bind row's description key is **`item_desc`** — which is also the name of the **PO line's** description field. They are unrelated.

So a Purchase Order implementation that reads `row.item_desc` looks right, compiles, runs, and never matches anything. Likewise `table_sup_item_bind` rows have no `item_desc` key at all.

**Do not write one parameterised helper for both families unless you unit-test the cross-contamination case in §7.** Two separate functions is the safer shape, and it is what desktop ships.

---

## 3. Per-Module Field Mapping

| | SQT | SO | PR | PO |
|---|---|---|---|---|
| Family | customer | customer | supplier | supplier |
| Bind table read | `table_cust_item_bind` | `table_cust_item_bind` | `table_sup_item_bind` | `table_sup_item_bind` |
| Line table | `table_sqt` | `table_so` | `table_pr` | `table_po` |
| **Line description field** | `sqt_desc` | `so_desc` | `pr_line_material_desc` | `item_desc` |
| Line's item FK | `material_id` | `item_name` | `pr_line_material_id` | `item_id` |
| Party field on the form | `sqt_customer_id` | `customer_name` | `pr_supplier_name` | `po_supplier_id` |

Two things in that table that read wrong but are correct:

- **SO's item FK is called `item_name`** and it holds an **id**, not a name. (The human-readable item name lives in SO's `item_id` field. Yes, really — `item_name` holds the id and `item_id` holds the name. Do not "fix" this.)
- **SO's party field is called `customer_name`** and it also holds an **id**.

All four party fields hold the partner's **primary `id`** — every picker binds `props.value: "id"` — which is exactly what the bind row's `customer_id` / `supplier_id` stores. **No translation step, no extra lookup.** Do not pass a customer code or supplier code.

---

## 4. The Two Helper Bodies (verbatim)

Copied exactly from the shipped desktop source. Each is byte-identical across its family's six files.

**Customer family** — from `Sales Order/SOchangeItem.js` (identical in `SObatchAddLineItem.js`, `SOonChangeCust.js`, `Quotation/SQTchangeItem.js`, `SQTbatchAddLineItem.js`, `SQTchangeCustomer.js`):

```js
// Pick the description this customer has bound to the item on the Item master.
// An item may carry several rows for the same customer -- take the first one
// that actually has a description. Falls back to the item's own material_desc.
const resolveItemDesc = (item, customerId) => {
  const fallback = item?.material_desc || "";
  if (!customerId || Array.isArray(customerId)) return fallback;

  const binds = Array.isArray(item?.table_cust_item_bind)
    ? item.table_cust_item_bind
    : [];
  const wanted = String(customerId).trim();

  for (const row of binds) {
    if (!row) continue;
    if (String(row.customer_id ?? "").trim() !== wanted) continue;
    const desc = String(row.item_desc ?? "").trim();
    if (desc) return desc;
  }

  return fallback;
};
```

**Supplier family** — from `Purchase Order/POonChangeItem.js` (identical in `PObatchAddLineItem.js`, `POonChangeSupplier.js`, `Purchase Requisition/PRonChangeItem.js`, `PRbatchAddLineItem.js`, `PRonChangeSupplier.js`):

```js
// Pick the description this supplier has bound to the item on the Item master.
// Reads table_sup_item_bind (supplier_id / item_description) -- NOT the customer
// twin. An item may carry several rows for the same supplier: take the first one
// that actually has a description. Falls back to the item's own material_desc.
const resolveItemDesc = (item, supplierId) => {
  const fallback = item?.material_desc || "";
  if (!supplierId || Array.isArray(supplierId)) return fallback;

  const binds = Array.isArray(item?.table_sup_item_bind)
    ? item.table_sup_item_bind
    : [];
  const wanted = String(supplierId).trim();

  for (const row of binds) {
    if (!row) continue;
    if (String(row.supplier_id ?? "").trim() !== wanted) continue;
    const desc = String(row.item_description ?? "").trim();
    if (desc) return desc;
  }

  return fallback;
};
```

Note the deliberate details:

- **`Array.isArray(partyId)` guard** — some pickers hand back an array; treat that as "no partner".
- **`String(...).trim()` on both sides** — a bind row may store a numeric id while the form value is a string.
- **`if (!row) continue`** — the array can contain `null` holes.
- **The matched description is trimmed; the `material_desc` fallback is returned raw**, matching what the field previously wrote.
- **A blank matched row does not stop the walk** — it falls through to the next matching row.

---

## 5. Three Touch Points

### 5.1 Item picked on a line

When the user picks an item on an existing line, resolve against the currently selected partner. The partner id is already on the form.

Desktop reference — `Sales Order/SOchangeItem.js`:

```js
updates[`table_so.${item.line_index}.so_desc`] = resolveItemDesc(
  arguments[0].fieldModel.item,
  customerID,
);
```

Per module, substitute from §3. Purchase Order, for example:

```js
updates[`table_po.${item.line_index}.item_desc`] = resolveItemDesc(
  arguments[0].fieldModel.item,
  supplierID,
);
```

Desktop files: `SQTchangeItem.js` · `SOchangeItem.js` · `PRonChangeItem.js` · `POonChangeItem.js`.

**No extra fetch.** The item object the picker returns is the full Item record and already carries the bind array. If your mobile picker returns a trimmed object, see the projection warning in §6.

### 5.2 Batch add items

Same call, once per selected item, while building the new line rows.

Desktop reference — `Sales Order/SObatchAddLineItem.js`:

```js
const soItem = {
  item_name: item.id,
  item_id: item.material_name,
  so_desc: resolveItemDesc(item, customerID),
  // ...
};
```

Desktop files: `SQTbatchAddLineItem.js` · `SObatchAddLineItem.js` · `PRbatchAddLineItem.js` · `PObatchAddLineItem.js`.

**No extra fetch** — same reasoning as §5.1.

### 5.3 Partner changed — ⚠️ ONLY IF your screen re-prices on customer/supplier change

> **Skip this whole section if your mobile screen picks the partner once and never re-prices.** §5.1 and §5.2 alone give correct behaviour for that flow. This section exists because the desktop forms show an **Overwrite / Keep** confirm dialog when the partner changes on a document that already has lines, and the description follows that choice.

When the partner changes, the existing lines' descriptions belong to the *old* partner. But the line rows **do not carry the bind array** — only the item's id. So you need the Item masters.

**Do it as one batched fetch, started before the pricing call so it overlaps the round-trip** — not a fetch per line, and not a sequential fetch afterwards.

Desktop reference — `Purchase Order/POonChangeSupplier.js`:

```js
// Line -> item master, needed to re-resolve item_desc for the new
// supplier. Started here (not awaited) so the single batched fetch
// overlaps the pricing workflow round-trip.
const itemIdByLine = {};
tablePO.forEach((line, index) => {
  if (line.item_id) itemIdByLine[index] = line.item_id;
});
const itemIds = [...new Set(Object.values(itemIdByLine))];
const itemsPromise = itemIds.length
  ? db
      .collection("Item")
      .filter(new Filter().in("id", itemIds).build())
      .get()
      .catch(() => ({ data: [] }))
  : Promise.resolve({ data: [] });
```

Resolved at the top of the pricing callback:

```js
const resItems = await itemsPromise;
const itemById = {};
for (const it of (resItems && resItems.data) || [])
  itemById[String(it.id)] = it;
```

And applied **only in the "Overwrite" path**, alongside the price fields:

```js
// Re-resolve the line description against the new supplier's binding.
const masterId = itemIdByLine[item.line_index];
const master = masterId ? itemById[String(masterId)] : null;
if (master) {
  updates[`table_po.${item.line_index}.item_desc`] = resolveItemDesc(
    master,
    supplierId,
  );
}
```

**Gating it to Overwrite is deliberate.** "Keep" then preserves both the price *and* any description the user typed by hand — you get manual-edit protection for free, with no need to detect whether a description was hand-edited.

Desktop also updates the dialog copy, since the choice now covers more than price:

> **Overwrite:** Replace the price **and description** based on the latest supplier. *(If any)*
> **Keep:** Keep the existing item price **and description**.

Desktop files: `SQTchangeCustomer.js` · `SOonChangeCust.js` · `PRonChangeSupplier.js` · `POonChangeSupplier.js`.

---

## 6. Rules That Are Not Obvious

### 6.1 Never re-resolve when loading or editing an existing document

Desktop's item-change handlers have a restore branch (`!fieldModel && <x>Item`) that runs when an existing document is opened. **It deliberately never touches descriptions** — it only refreshes stock quantities and UOM option lists.

A saved document keeps the text it was saved with, even if the binding is edited afterwards. If mobile re-resolves on open, editing an Item master would silently rewrite the wording on historical quotes and orders.

### 6.2 A `.field(...)` projection will silently kill this

If your Item fetch projects a column list, the bind array **must be in it**. Desktop does exactly this kind of projection elsewhere — `Sales Order/SOonChangeCust.js` fetches Customer with `.field("customer_currency_id,customer_payment_term_id,…")`.

An Item fetched without `table_cust_item_bind` / `table_sup_item_bind` is **indistinguishable from an item that has no bindings**. You will get `material_desc` and no error. This is the single most likely way for a correct implementation to appear to do nothing.

The same applies to whatever your item **picker** returns: if it hands back a trimmed projection rather than the full record, either widen the projection or fetch the Item before resolving.

### 6.3 PR "New Supplier" mode needs no special handling

Purchase Requisition has a `supplier_type` toggle:

- **Existing Supplier** → `pr_supplier_name` holds a Supplier id. Normal path.
- **New Supplier** → free-text `pr_new_supplier_name`, and no Supplier record exists to bind against.

In "New Supplier" mode `pr_supplier_name` is empty, so the helper's `!supplierId` guard already returns `material_desc`. **Do not** pass `pr_new_supplier_name` as the party id — it is a name, never an id, and it can only produce a false match or a wasted walk.

### 6.4 Conversions inherit automatically — do not re-resolve

- `Quotation/SQTtoSO.js` and the Quotation bulk `ConvertToSO.js` copy `sqt_desc → so_desc`.
- `Purchase Requisition/PRconvertPO.js` copies `pr_line_material_desc → item_desc`.

These already carry the resolved description forward. Re-resolving at convert time would overwrite any deliberate edit made on the source document, and would use the *converting* user's partner rather than the one the document was quoted for.

### 6.5 No line field for the alias

The bind rows carry `cust_item_alias` / `sup_item_alias`, but **no document line has a field for it** in any of the four modules. Only the description is in scope. Don't add one without a schema change.

---

## 7. Edge-Case / Test Matrix

Both helpers must satisfy all thirteen. These are the exact cases the desktop harness asserts against both families.

`P1`/`P2` = party ids. "Party" = customer for SQT/SO, supplier for PR/PO.

| # | Item's bind rows | Party id | Expected |
|---|---|---|---|
| 1 | `[P1 "Blue widget, 20mm"], [P1 "Blue widget, export packing"], [P2 "Beta wording"], null` | `P1` | `"Blue widget, 20mm"` — **first index wins** |
| 2 | same as #1 | `P2` | `"Beta wording"` |
| 3 | `[P1 "   "], [P1 "Second row wins"]` | `P1` | `"Second row wins"` — blank does not stop the walk |
| 4 | `[P1 ""], [P1 null]` | `P1` | `material_desc` |
| 5 | same as #1 | `P9` | `material_desc` — party has no rows |
| 6 | *bind column absent entirely* | `P1` | `material_desc` |
| 7 | same as #1 | `null` | `material_desc` |
| 8 | same as #1 | `""` | `material_desc` |
| 9 | same as #1 | `["a"]` (array) | `material_desc` |
| 10 | `[12345 "Numeric"]` (numeric id) | `"12345"` (string) | `"Numeric"` |
| 11 | `[]` and item has **no** `material_desc` | `P1` | `""` |
| 12 | item itself is `undefined` | `P1` | `""` — must not throw |
| 13 | item bound **only under the other family's table** | `P1` | `material_desc` — **the cross-contamination guard** |

**Case 13 is the one that catches §2.** Feed the supplier helper an item that has only `table_cust_item_bind` (with `customer_id` / `item_desc` keys) and assert it returns `material_desc`; then the mirror case for the customer helper. If either returns the other family's text, the key names have been crossed.

---

## 8. Mobile Porting Checklist

### Helper correctness
- [ ] Two separate helpers, one per family — not one parameterised function
- [ ] Customer helper reads `table_cust_item_bind` / `customer_id` / `item_desc`
- [ ] Supplier helper reads `table_sup_item_bind` / `supplier_id` / **`item_description`**
- [ ] First matching row with non-blank text wins; blank rows fall through
- [ ] `material_desc` fallback on every miss
- [ ] `Array.isArray(partyId)` and empty/null party id both return the fallback
- [ ] `String(...).trim()` comparison on both sides
- [ ] `null` rows in the array are skipped
- [ ] Never throws on an undefined item

### Per-module wiring (repeat for SQT, SO, PR, PO)
- [ ] Item picked on a line → resolves, using the §3 line description field
- [ ] Batch add → resolves per selected item
- [ ] Correct family helper wired to the correct module (SQT/SO customer, PR/PO supplier)
- [ ] Party id read from the §3 form field — and it is an **id**, not a code or name
- [ ] SO uses `item_name` for the item id and `so_desc` for the description (see §3 note)

### Fetch & projection
- [ ] The Item object reaching the helper actually contains the bind array — **log it once to confirm**
- [ ] Any `.field(...)` projection on an Item fetch includes the bind column
- [ ] Partner-change path (if you have one) uses **one batched** Item fetch, not one per line

### Don't-re-resolve rules
- [ ] Opening / editing an existing document does **not** re-resolve descriptions
- [ ] SQT→SO and PR→PO conversions copy the description through, do **not** re-resolve
- [ ] Partner-change re-resolution (if implemented) happens **only** on "Overwrite", never on "Keep"
- [ ] PR "New Supplier" mode passes no party id (never `pr_new_supplier_name`)

### Reference checks (do these last)
- [ ] All 13 cases in §7 pass for **both** helpers — case 13 especially
- [ ] Bind an item to a customer with 2 descriptions → SQT and SO lines both show the **first**
- [ ] Bind an item to a supplier with 2 descriptions → PR and PO lines both show the **first**
- [ ] Same item, partner with no binding → `material_desc`, on all four modules
- [ ] Create a document with **no partner selected** → `material_desc`, no error
- [ ] Convert a quote → SO line description matches the quote's, not a re-resolve
- [ ] Open a saved document whose binding has since changed → text unchanged
- [ ] Cross-check one document created on mobile against the same one created on web → identical description
