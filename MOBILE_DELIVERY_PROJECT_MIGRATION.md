# Mobile Migration — Delivery Info consolidation + `project_id`

Handoff for the mobile team. Two independent desktop changes that mobile must
mirror, or it will read and write columns the desktop no longer uses.

Desktop side is complete and verified across 20 forms, 23 workflows and 11
converters. Nothing is deployed yet.

---

## Why

**1. Delivery Info consolidation.** Every document used to carry five parallel
delivery sections — Self Pickup, Courier Service, Company Truck, Shipping Service,
3rd Party Transporter — with the same concept named differently in each module.
`Driver Name` alone existed under seven different column names across seven forms.

Because exactly one section is ever populated per record, all five collapse into
**one shared set of 13 `di_*` columns**. The per-method sections and the
show/hide-by-delivery-method logic go away entirely.

This also removes the reason `Picking/MOBILE_DELIVERY_FIELDS_HANDOFF.md` exists —
that document is a 31-field GD→Picking remap table which only existed because the
names diverged. **It is superseded by this document.**

**2. `project_id`.** A new FK to the Project master at both header and line-item
level, so a document and each of its lines can be attributed to a project.

---

## Scope

**Delivery Info (7):** SQT, SO, GD, SR, Picking, PRT, Packing
**`project_id` (18):** SQT, SO, GD, SI, SR, SRR, PREQ, PO, GR, PI, PRT, Picking,
Putaway, Misc Issue, Misc Receipt, Plant Transfer, Location Transfer, Category Transfer

| Module | Delivery Info | `project_id` | Line array |
|---|---|---|---|
| Quotation (SQT) | ✅ 13 fields | ✅ header + line | `table_sqt` |
| Sales Order (SO) | ✅ | ✅ | `table_so` |
| Goods Delivery (GD) | ✅ | ✅ | `table_gd` |
| Sales Return (SR) | ✅ | ✅ | `table_sr` |
| Picking | ✅ | ✅ | `table_picking_items` |
| Purchase Return (PRT) | ✅ | ✅ | `table_prt` |
| Packing | ✅ read-only | — | — |
| Sales Invoice (SI) | — | ✅ | `table_si` |
| Sales Return Receiving (SRR) | — | ✅ | `table_srr` |
| Purchase Requisition (PREQ) | — | ✅ | `table_pr` |
| Purchase Order (PO) | — | ✅ | `table_po` |
| Goods Receiving (GR) | — | ✅ | `table_gr` |
| Purchase Invoice (PI) | — | ✅ | `table_pi` |
| Putaway | — | ✅ | `table_putaway_item` |
| Misc Issue (MSI) | — | ✅ | `stock_movement` |
| Misc Receipt (MSR) | — | ✅ | `stock_movement` |
| Plant Transfer (PT) | — | ✅ | `stock_movement` |
| Location Transfer (LOT) | — | ✅ | `stock_movement` |
| Category Transfer (CAT) | — | ✅ | `stock_movement` |

> ⚠️ **The line array is not always `table_*`.** All five Stock Movement variants
> use **`stock_movement`**. Bind the array name from this table, not by convention.

Three modules are deliberately absent:

- **SRR has no Delivery Info at all.** `SRRfullJSON.json` binds zero delivery
  fields — neither `di_*` nor the old per-method ones. It never had a delivery
  section. SRR is `project_id` only.
- **Picking Plan (PP) is desktop-only.** It carries both the 13 Delivery Info
  fields *and* `project_id` (line array `table_to`), but mobile does not implement
  PP. No mobile work either way.
- **Stock Adjustment (SA) is desktop-only.** It carries `project_id` (line array
  `stock_adjustment`), but mobile does not implement SA.

**Transition strategy: clean switch.** Mobile reads and writes `di_*` only, with no
fallback to the old columns. See [Sequencing](#sequencing) — this makes the data
migration a hard prerequisite.

---

## Change 1 — Delivery Info

### The 13 fields

Identical names, labels and types on **every** module. That uniformity is the point:
one binding set, reused everywhere, no per-module remap.

| Field | Label | Control | Stores |
|---|---|---|---|
| `di_shipping_method` | Shipping Method | table-select | **id** → Shipping Method `1902675462858063873` |
| `di_driver_name` | Driver Name | table-select | **id** → Driver `1983820088528023553` |
| `di_ic_no` | IC No | text | text |
| `di_driver_contact_no` | Driver Contact No | text | text |
| `di_vehicle_number` | Vehicle Number | select | **id** → Vehicle `1983800272178065410` |
| `di_shipping_company` | Shipping Company | select | **`courier_name` string** → Courier Company `1901984960940724226` |
| `di_transport_name` | Transport Name | text | text |
| `di_est_delivery_date` | Est Delivery Date | date | date |
| `di_est_arrival_date` | Est Arrival Date | date | date |
| `di_pickup_date` | Pickup Date | date | date |
| `di_validity_of_collection` | Validity of Collection | date | date |
| `di_tracking_number` | Tracking Number | text | text |
| `di_freight_charges` | Freight Charges | currency | decimal, precision 2 |

> ⚠️ **`di_shipping_company` is the odd one out.** It stores the `courier_name`
> **string**, not an id, while the other three pickers store ids. Do not "fix" this
> to an id — the desktop column holds the name.

### Behaviour rules

**1. One flat section, no method branching.**
Render all 13 together. Do **not** port the five per-method sections, and do not
show/hide anything based on delivery method. Two fields deliberately carry two
concepts each:

- `di_est_delivery_date` — a Company-Truck delivery date **or** a Courier /
  Shipping Service shipping date
- `di_freight_charges` — freight charges **or** a company-truck delivery cost

Their labels are generic by design. Don't rename them per context.

**2. Do not bind the legacy method selector.**
`sqt_delivery_method_id`, `so_delivery_method`, `gd_delivery_method`,
`to_delivery_method`, `sr_delivery_method`, `return_delivery_method` and Picking's
`delivery_method` are all `hidden: true` on desktop and are **not** part of this
block. `di_shipping_method` is an independent Shipping Method FK — it is *not* a
replacement discriminator and does not drive any conditional display.

**3. Driver auto-fill.**
When `di_driver_name` is picked, fill from the selected Driver record:

| Driver column | → target field |
|---|---|
| `driver_ic` | `di_ic_no` |
| `driver_contact` | `di_driver_contact_no` |

Desktop does this on the field's onChange. Mirror it — otherwise the id-based picker
leaves both text fields empty and users have to retype what the master already holds.

**3b. Packing is READ-ONLY — it is the one module that does not own its values.**
Packing has all 13 `di_*` columns, but every one of them is `disabled` on the desktop
form. The values are stamped on by the **Picking** that spawns the Packing, and the
Picking header stays the single source of truth for them.

- **Do not render pickers on Packing.** No Driver / Vehicle / Shipping Method
  selection, and **do not** mirror the driver auto-fill from rule 3 — the field that
  triggers it can never be touched.
- **Do not write `di_*` from a mobile Packing save.** Desktop persists them, but only
  by echoing back what it loaded.
- Every Picking save re-stamps them, so a Packing's delivery info can change
  underneath a stale screen. Re-read on focus rather than caching it.
- Packing has **neither `area_id` nor `area_name`** — both are Picking-only. Note
  they are two independent fields, *not* an id/label pair: `area_name` is
  "Zone / Area", a plain-name field in its own right, and the two carry
  different values. (In dev, no `transfer_order` row populates both.)

**4. Delete the old bindings.**
Remove every per-method delivery field mobile currently binds. Picking alone has 39.
The full old→new mapping per module is in [Appendix A](#appendix-a--old--new-field-map)
— use it to confirm nothing is dropped, not as a runtime path.

**5. Conversions carry straight across.**
Because the names are identical everywhere, GD→Picking and SO→GD copy field-for-field
with no remap. If mobile performs conversions, keep the desktop's **single-source
guard**: when more than one source document is selected, leave all 13 fields empty
rather than merging ambiguous delivery arrangements.

---

## Change 2 — `project_id`

- **FK → Project `2085600321692696577`, stores the record id.** Same on all
  eighteen modules.
- **Two bindings per form** — the header, and one inside the line-item array. The
  array name differs per module; see the [Scope](#scope) table.
- **No cascade.** There is no `onChange` on any form — picking a header project
  does **not** populate the lines. Each line is set independently, and a blank line
  stays blank through conversion. If mobile wants header→line auto-fill, raise it
  as a product decision rather than adding it silently.
- **Never carry `project_id` across organizations.** Project is org-scoped, so the
  cross-org bridges (GD→GR, SI→PI) deliberately omit it. Any internal-trading
  conversion on mobile must do the same — copying the id would point at a project
  row the receiving org does not own.

### Where it flows

Both header and line-level values carry through every same-org conversion:

```
SQT → SO → GD → SI          GD → Picking
PREQ → PO → GR → PI         GR → Putaway

no inbound conversion: SR, SRR, PRT,
                       MSI, MSR, PT, LOT, CAT
```

The five Stock Movement variants are entered directly — nothing converts into them,
so `project_id` is only ever typed on the form and saved.

Two of these are worth calling out because the value is rebuilt rather than copied:

- **GD → Picking** — the Picking record is assembled from a `transferOrderData`
  object, so `project_id` is set on that object rather than passed straight through.
- **GR → Putaway** — the Putaway header and each Putaway **line** are built by two
  separate whitelists. The line builder runs inside the GR subform loop, so the
  line-level project is a distinct mapping from the header one. Mobile must set
  both if it creates Putaways from a GR.

---

## Sequencing

The clean-switch decision creates a hard ordering for Delivery Info:

1. **Run the data migration first.** Until the old per-method columns are folded
   into `di_*`, every pre-existing record has empty `di_*` values. A mobile build
   that reads `di_*` only will show blank delivery info on all historical records.
2. **Deploy the desktop workflows** (currently unreleased) so new records start
   populating `di_*` and `project_id`.
3. **Then ship mobile.**

`project_id` has no such dependency — it is a brand-new field with no legacy column
to migrate, so mobile can build and ship it independently of step 1.

No column work is required: all 13 `di_*` fields and both `project_id` bindings are
already `dataBind: true` on every form, so the columns exist on every collection.

---

## Verification

### Delivery Info

- Create a record on each of the six modules, fill all 13 fields, save, reopen —
  values persist and no per-method section appears.
- Pick a Driver → IC No and Driver Contact No auto-populate.
- Confirm `di_shipping_company` round-trips the courier **name**, while
  `di_shipping_method`, `di_driver_name` and `di_vehicle_number` round-trip **ids**.
- Convert SO→GD and GD→Picking from a **single** source → all 13 carry over.
- Convert from **two** source documents → all 13 come through empty.
- Save `di_freight_charges` as `12.35` → stored at 2 dp.

### `project_id`

- Set a header project and a *different* project on one line; save and reopen —
  both persist independently. Repeat on all eighteen modules — and on the five
  Stock Movement variants confirm you bound `stock_movement`, not `table_*`.
- Convert SQT→SO, SO→GD, GD→SI, PREQ→PO, PO→GR, GR→PI → header and per-line values
  arrive intact.
- **GD→Picking** and **GR→Putaway** → header *and* line values arrive; these two are
  rebuilt rather than copied, so check the line level explicitly.
- Convert from **two** source documents into one Picking → `project_id` comes through
  empty, same single-source rule as Delivery Info.
- Convert across organizations (GD→GR, SI→PI) → `project_id` is empty on the
  receiving document.

### Regression

Search the mobile build for old delivery columns — `cp_`, `cs_`, `ct_`, `ss_`,
`tpt_`, `sp_vehicle_no`, `driver_name`, `ic_no`, `vehicle_no`, `courier_company`.
Nothing should remain in a delivery context.

---
---

# Appendix A — Old → new field map

Which legacy column each `di_*` field replaces, per module. **Mobile uses this to
know what to delete**; the DB team uses it as the migration source map.

Derived by reading the form JSONs directly (`SQTfullJSON.json`, `SOfullJSON.json`,
`GDfullJSON.json`, `PPfullJSON.json`, `PickingFullJSON.json`, `PRTfullJSON.json`,
`SRfullJSON.json`) —
component types and stored value shapes taken from each field's `el` and
`options.props.value`, not inferred from names.

`SP` = Self Pickup · `CS` = Courier Service · `CT` = Company Truck ·
`SS` = Shipping Service · `TPT` = 3rd Party Transporter.
`[ID]` marks a source that already stores a record id rather than a display string.

> **PP is included for completeness** — it is a desktop-only module (see *Scope*).
> Mobile can ignore that column.

Each row is a `CASE` on the record's delivery method: the source column depends on
which section was active, so a straight column copy is wrong for the nine fields
with more than one source.

| # | di_ field | SQT | SO | GD | PP | PICK | PRT | SR |
|---|---|---|---|---|---|---|---|---|
| 1 | `di_driver_name` | SP:`cp_customer_pickup`<br>CT:`ct_driver_name` **[ID]**<br>TPT:`tpt_driver_name` | SP:`cp_driver_name`<br>CT:`ct_driver_name` **[ID]**<br>TPT:`tpt_driver_name` | SP:`driver_name`<br>CT:`driver_name`<br>TPT:`tpt_driver_name` | SP:`driver_name`<br>CT:`driver_name`<br>TPT:`tpt_driver_name` | SP:`driver_name`<br>CT:`ct_driver_name`<br>TPT:`tpt_driver_name` | SP:`driver_name`<br>CT:`driver_name2` | SP:`sr_driver_name`<br>CT:`sr_driver_name`<br>TPT:`tpt_driver_name` |
| 2 | `di_ic_no` | SP:`cp_ic_no`<br>CT:`ct_ic_no`<br>TPT:`tpt_ic_no` | SP:`cp_ic_no`<br>CT:`ct_ic_no`<br>TPT:`tpt_ic_no` | SP:`ic_no`<br>CT:`ic_no`<br>TPT:`tpt_ic_no` | SP:`ic_no`<br>CT:`ic_no`<br>TPT:`tpt_ic_no` | SP:`ic_no`<br>CT:`ct_ic_no`<br>TPT:`tpt_ic_no` | SP:`cp_ic_no`<br>CT:`ct_ic_no`<br>TPT:`tpt_ic_no` | SP:`cp_ic_no`<br>CT:`ct_ic_no`<br>TPT:`tpt_ic_no` |
| 3 | `di_driver_contact_no` | SP:`driver_contact_no`<br>CT:`ct_driver_contact_no`<br>TPT:`tpt_driver_contact_no` | SP:`cp_driver_contact_no`<br>CT:`ct_driver_contact_no`<br>TPT:`tpt_driver_contact_no` | SP:`driver_contact_no`<br>CT:`driver_contact_no`<br>TPT:`tpt_driver_contact_no` | SP:`driver_contact_no`<br>CT:`driver_contact_no`<br>TPT:`tpt_driver_contact_no` | SP:`driver_contact_no`<br>CT:`ct_driver_contact_no`<br>TPT:`tpt_driver_contact_no` | SP:`driver_contact`<br>CT:`driver_contact_no2`<br>TPT:`tpt_driver_contact_no` | SP:`sr_driver_contact_no`<br>CT:`sr_driver_contact_no`<br>TPT:`tpt_driver_contact_no` |
| 4 | `di_vehicle_number` | SP:`vehicle_number`<br>CT:`ct_vehicle_number` **[ID]**<br>TPT:`tpt_vehicle_number` | SP:`cp_vehicle_number`<br>CT:`ct_vehicle_number` **[ID]**<br>TPT:`tpt_vehicle_number` | SP:`sp_vehicle_no`<br>CT:`vehicle_no` **[ID]**<br>TPT:`tpt_vehicle_number` | SP:`vehicle_no`<br>CT:`vehicle_no`<br>TPT:`tpt_vehicle_number` | SP:`sp_vehicle_no`<br>CT:`vehicle_no` **[ID]**<br>TPT:`tpt_vehicle_number` | SP:`vehicle_no`<br>CT:`vehicle_no2`<br>TPT:`tpt_vehicle_number` | SP:`sr_vehicle_no`<br>CT:`sr_vehicle_no`<br>TPT:`tpt_vehicle_number` |
| 5 | `di_pickup_date` | SP:`pickup_date` | SP:`cp_pickup_date` | SP:`pickup_date` | SP:`pickup_date` | SP:`pickup_date` | SP:`pickup_date` | SP:`sr_pickup_date` |
| 6 | `di_validity_of_collection` | SP:`validity_of_collection` | SP:`validity_of_collection` | SP:`validity_of_collection` | SP:`validity_of_collection` | SP:`validity_of_collection` | — | SP:`validity_of_collection` |
| 7 | `di_shipping_company` | CS:`courier_company`<br>SS:`ss_shipping_company` | CS:`cs_courier_company`<br>SS:`ss_shipping_company` | CS:`courier_company`<br>SS:`shipping_company` | CS:`courier_company`<br>SS:`shipping_company` | CS:`courier_company`<br>SS:`shipping_company` | CS:`courier_company` | CS:`courier_company`<br>SS:`shipping_company` |
| 8 | `di_est_delivery_date` | CS:`shipping_date`<br>CT:`ct_est_delivery_date`<br>SS:`ss_shipping_date` | CS:`cs_shipping_date`<br>CT:`ct_est_delivery_date`<br>SS:`ss_shippping_date` | CS:`shipping_date`<br>CT:`est_delivery_date`<br>SS:`shipping_date` | CS:`shipping_date`<br>CT:`est_delivery_date`<br>SS:`shipping_date` | CS:`shipping_date`<br>CT:`est_delivery_date`<br>SS:`ss_shipping_date` | CS:`shipping_date`<br>CT:`estimated_arrival2` | CS:`sr_shipping_date`<br>CT:`sr_est_delivery_date`<br>SS:`sr_shipping_date` |
| 9 | `di_est_arrival_date` | CS:`cs_est_arrival_date`<br>SS:`est_arrival_date` | CS:`est_arrival_date`<br>SS:`ss_est_arrival_date` | CS:`est_arrival_date`<br>SS:`est_arrival_date` | CS:`est_arrival_date`<br>SS:`est_arrival_date` | CS:`est_arrival_date`<br>SS:`ss_est_arrival_date` | CS:`estimated_ariival` | CS:`sr_est_arrival_date`<br>SS:`sr_est_arrival_date` |
| 10 | `di_freight_charges` | CS:`freight_charges`<br>CT:`ct_delivery_cost`<br>SS:`ss_freight_charges` | CS:`cs_freight_charges`<br>CT:`ct_delivery_cost`<br>SS:`ss_freight_charges` | CS:`freight_charges`<br>CT:`delivery_cost`<br>SS:`freight_charges` | CS:`freight_charges`<br>CT:`delivery_cost`<br>SS:`freight_charges` | CS:`freight_charges`<br>CT:`delivery_cost`<br>SS:`ss_freight_charges` | CS:`freight_charge`<br>CT:`delivery_cost` | CS:`sr_freight_charges`<br>CT:`sr_delivery_cost`<br>SS:`sr_freight_charges` |
| 11 | `di_tracking_number` | CS:`cs_tracking_number`<br>SS:`ss_tracking_number` | CS:`cs_tracking_number`<br>SS:`ss_tracking_number` | CS:`tracking_number`<br>SS:`tracking_number` | CS:`tracking_number`<br>SS:`tracking_number` | CS:`tracking_number`<br>SS:`ss_tracking_number` | — | CS:`sr_tracking_no`<br>SS:`sr_tracking_number` |
| 12 | `di_transport_name` | TPT:`tpt_transport_name` | TPT:`tpt_transport_name` | TPT:`tpt_transport_name` | TPT:`tpt_transport_name` | TPT:`tpt_transport_name` | TPT:`tpt_transport_name` | TPT:`tpt_transport_name` |

`di_shipping_method` is not in the table above because its source is a single
column per module rather than a per-method set — see below.

### `di_shipping_method` — migrated via lookup

The legacy Shipping-Service sub-choice **is** carried. It stores free text while
`di_shipping_method` stores a Shipping Method **id**, so the migration resolves it
by matching against both `shipping_method_name` and `shipping_method_code`
(the column was originally a select storing the name, later degraded to a plain
text input). Unmatched values land NULL and are reported.

| Module | Legacy source column |
|---|---|
| SQT, SO | `ss_shipping_method` |
| GD, PP, PICK | `shipping_method` |
| PRT | `shipping_method` (sits under **Courier Service**, not Shipping Service) |
| SR | `shipping_method` |

---

# Appendix B — Data-migration notes

**Audience: the desktop / DB team, not mobile.** Included so this file stands alone.

## Two rows need a lookup, not a copy

Migrating these by name writes garbage silently.

### `di_driver_name` wants a Driver **id**

- **Already ids:** SQT `ct_driver_name`, SO `ct_driver_name` — Company Truck only.
- **Need a name→id lookup:** the other 18 sources store a typed name string — every
  Self Pickup and 3rd Party column, plus GD/PP/PICK/PRT/SR Company Truck.
- **Unresolvable:** a typed name with no matching Driver record has no landing spot.
  Decide up front — create Driver records, leave null, or keep a text fallback.

This also means a customer's own collector must exist in the Driver master before
it can be recorded.

### `di_vehicle_number` wants a Vehicle **id**

Mirrors the above exactly — both destinations are id-backed pickers whose only
already-correct sources are Company Truck.

- **Already ids:** SQT `ct_vehicle_number`, SO `ct_vehicle_number`, GD `vehicle_no`,
  PICK `vehicle_no`.
- **Need a plate→id lookup:** the other 17 sources store a free-typed plate string —
  every Self Pickup and 3rd Party column, plus PP `vehicle_no`, PRT `vehicle_no2`
  and SR `sr_vehicle_no`.
- **Unresolvable:** a typed plate with no matching Vehicle record, same as above.

## Per-module quirks

**PRT is the ragged one**

- No source for `di_validity_of_collection` or `di_tracking_number` → null.
- No 3rd-Party driver name → null.
- Its Shipping Method sits under **Courier Service**, not Shipping Service.
- `estimated_ariival` is misspelled in the source form.
- Company Truck's "Estimated Arrival" (`estimated_arrival2`) maps to
  `di_est_delivery_date`, not `di_est_arrival_date` — it is a delivery date despite
  the label.
- `freight_charge` is a plain input, not a currency component, so values may not be
  2-dp clean. Round before writing into `di_freight_charges`.

### SR shares the most columns

- Self Pickup and Company Truck share `sr_driver_name`, `sr_driver_contact_no`
  and `sr_vehicle_no`.
- Courier Service and Shipping Service share `sr_shipping_date`,
  `sr_freight_charges` and `sr_est_arrival_date`.
- It has **two** tracking columns: `sr_tracking_no` (Courier) and
  `sr_tracking_number` (Shipping Service).
- `sr_freight_charges` is a plain input, not a currency component — round to 2 dp
  before writing into `di_freight_charges`.

All safe, because only one delivery method is ever populated per record — but the
same source column appearing under several `WHEN` branches looks wrong at a glance.

**SO** — `ss_shippping_date` has a triple `p`; that really is the column name.

**GD / PP** — Self Pickup and Company Truck *share* `driver_name`, `ic_no` and
`driver_contact_no`. Harmless for migration (only one method is ever populated per
record), but it is why the Picking remap table existed.

## Pre-flight checklist

- [ ] Seed missing Driver records, or set the null/fallback policy for unmatched names.
- [ ] Build the plate→id lookup for the 14 free-text vehicle sources, and set the
      policy for plates with no Vehicle record.
- [ ] Confirm the legacy delivery-method column is populated on every historical
      record — it is the `CASE` key for all nine multi-source rows. Records with a
      null method cannot be migrated.
- [ ] Round PRT `freight_charge` to 2 dp.
- [ ] Decide the fate of the dropped `shipping_method` columns.
- [ ] Remove the five old sections (`qt_self_pickup`, `qt_courier_service`,
      `qt_company_truck`, `qt_shipping_service`, `third_party_transporter`) only
      after the data is verified in the `di_*` columns.
- [ ] Update the show/hide logic — the five method literals are compared by name in
      roughly 30 places, including `visibilityMap` in `Quotation/SQTonMounted.js`,
      `func_reset_delivery_method`, and the equivalents in the other modules.
