# Picking: Carry Over GD Delivery Method + Area (Mobile Handoff)

## What this is

When a Picking is created from a Goods Delivery (GD) — either via the "Convert
to Picking" bulk action OR by GD auto-creation on save — the GD's **delivery
method**, **area**, and all delivery-detail fields should be carried onto the
new Picking record so the picker doesn't have to re-enter them.

This document is a complete handoff for the **mobile Picking** team: it lists
every field the mobile Picking form/collection must support, the exact
GD→Picking name mapping, the conditional remap logic, and the section-display
wiring. The desktop implementation is already done — mirror it on mobile.

---

## Behavior summary

1. **Single GD → fill** every delivery field from that GD (with the
   conditional remap below).
2. **Multiple GDs → leave all delivery fields empty** (`""`). Merging
   ambiguous delivery arrangements would be wrong.
3. After the Picking add-form is pre-filled, **reveal the section** matching
   the carried-over `delivery_method` (mirror `onChangeDeliveryMethod`'s
   visibility logic, but do **not** call `func_reset_delivery_method` —
   that would wipe the carried-over values).

---

## The 31 Picking-side fields to add

Add these as form models on the mobile Picking form (matching the
`transfer_order` / Picking collection columns `1935556443668959233`). All are
string-storable. Numeric/date fields can stay as their native input types; for
empty-state (multi-GD), use `""`.

| # | Picking field | Section | Notes |
|---|---|---|---|
| 1 | `delivery_method` | header (select) | Self Pickup / Courier Service / Company Truck / Shipping Service / 3rd Party Transporter |
| 2 | `delivery_method_text` | header (text) | Human-readable copy of the method |
| 3 | `area_id` | header (FK → Area `1901976591785906177`) | Delivery area |
| 4 | `driver_name` | Self Pickup | |
| 5 | `ic_no` | Self Pickup | |
| 6 | `driver_contact_no` | Self Pickup | |
| 7 | `sp_vehicle_no` | Self Pickup | |
| 8 | `pickup_date` | Self Pickup | date |
| 9 | `validity_of_collection` | Self Pickup | date |
| 10 | `courier_company` | Courier Service | |
| 11 | `shipping_date` | Courier Service | date |
| 12 | `tracking_number` | Courier Service | |
| 13 | `est_arrival_date` | Courier Service | date |
| 14 | `freight_charges` | Courier Service | number |
| 15 | `ct_driver_name` | Company Truck | |
| 16 | `ct_driver_contact_no` | Company Truck | |
| 17 | `ct_ic_no` | Company Truck | |
| 18 | `vehicle_no` | Company Truck | |
| 19 | `est_delivery_date` | Company Truck | date |
| 20 | `delivery_cost` | Company Truck | number |
| 21 | `shipping_company` | Shipping Service | |
| 22 | `ss_shipping_date` | Shipping Service | date |
| 23 | `ss_freight_charges` | Shipping Service | number |
| 24 | `shipping_method` | Shipping Service | |
| 25 | `ss_est_arrival_date` | Shipping Service | date |
| 26 | `ss_tracking_number` | Shipping Service | |
| 27 | `tpt_vehicle_number` | 3rd Party Transporter | |
| 28 | `tpt_transport_name` | 3rd Party Transporter | |
| 29 | `tpt_ic_no` | 3rd Party Transporter | |
| 30 | `tpt_driver_contact_no` | 3rd Party Transporter | |
| 31 | `tpt_driver_name` | 3rd Party Transporter | Bound in both forms but not in GD's `func_reset_delivery_method` — easy to miss |

### Section group keys (used for show/hide)

| Delivery method value | Section group key (component to display) |
|---|---|
| `Self Pickup` | `self_pickup` |
| `Courier Service` | `courier_service` |
| `Company Truck` | `company_truck` |
| `Shipping Service` | `shipping_service` |
| `3rd Party Transporter` | `third_party_transporter` |

---

## GD → Picking field-name mapping

The GD form and Picking form name some fields differently. **A naive same-name
copy is wrong for the renames below.** Always read from these GD fields:

### Header (always, when single GD)

| Picking field | ← GD field |
|---|---|
| `delivery_method` | `gd_delivery_method` |
| `delivery_method_text` | `delivery_method_text` *(fallback to `gd_delivery_method` value)* |
| `area_id` | `gd_area_id` |

### Per active delivery method (only the active method's fields are filled; the rest stay `""`)

**Self Pickup, Courier Service, 3rd Party Transporter** — identical names in both forms:

| Method | Picking field ← GD field (same name) |
|---|---|
| Self Pickup | `driver_name`, `ic_no`, `driver_contact_no`, `sp_vehicle_no`, `pickup_date`, `validity_of_collection` |
| Courier Service | `courier_company`, `shipping_date`, `tracking_number`, `est_arrival_date`, `freight_charges` |
| 3rd Party Transporter | `tpt_vehicle_number`, `tpt_transport_name`, `tpt_ic_no`, `tpt_driver_contact_no`, `tpt_driver_name` |

**Company Truck** — GD reuses Self-Pickup names; Picking uses `ct_*` / `vehicle_no`:

| Picking field | ← GD field |
|---|---|
| `ct_driver_name` | `driver_name` |
| `ct_driver_contact_no` | `driver_contact_no` |
| `ct_ic_no` | `ic_no` |
| `vehicle_no` | `sp_vehicle_no` |
| `est_delivery_date` | `est_delivery_date` |
| `delivery_cost` | `delivery_cost` |

**Shipping Service** — GD reuses Courier names; Picking uses `ss_*`:

| Picking field | ← GD field |
|---|---|
| `shipping_company` | `shipping_company` |
| `ss_shipping_date` | `shipping_date` |
| `ss_freight_charges` | `freight_charges` |
| `shipping_method` | `shipping_method` |
| `ss_est_arrival_date` | `est_arrival_date` |
| `ss_tracking_number` | `tracking_number` |

### Fields explicitly NOT mapped

The GD form has 7 vehicle/driver-selection fields (`select_vehicle_id`,
`gd_vehicle_type`, `gd_vehicle_capacity`, `gd_vehicle_cap_uom`,
`select_driver_id`, `gd_driver_contact`, `gd_driver_ic`) that the Picking
form does NOT bind. **Skip them** — don't add them to the mobile Picking.

---

## Reference logic (drop into mobile workflows)

This is the helper used in both desktop workflows. Mobile workflows can copy
this verbatim into the code-node that builds the Picking payload.

```javascript
const DELIVERY_FIELD_KEYS = [
  "delivery_method", "delivery_method_text", "area_id",
  "driver_name", "ic_no", "driver_contact_no", "sp_vehicle_no", "pickup_date", "validity_of_collection",
  "courier_company", "shipping_date", "tracking_number", "est_arrival_date", "freight_charges",
  "ct_driver_name", "ct_driver_contact_no", "ct_ic_no", "vehicle_no", "est_delivery_date", "delivery_cost",
  "shipping_company", "ss_shipping_date", "ss_freight_charges", "shipping_method", "ss_est_arrival_date", "ss_tracking_number",
  "tpt_vehicle_number", "tpt_transport_name", "tpt_ic_no", "tpt_driver_contact_no", "tpt_driver_name",
];

// gdList = array of GD records being converted.
// Returns an object with all 31 Picking-side keys.
// Multi-GD: all keys "". Single GD: header + active method's fields filled.
const buildDeliveryFields = (gdList) => {
  const fields = {};
  for (const k of DELIVERY_FIELD_KEYS) fields[k] = "";
  if (gdList.length !== 1) return fields;

  const gd = gdList[0];
  const method = gd.gd_delivery_method || "";
  fields.delivery_method = method;
  fields.delivery_method_text = gd.delivery_method_text || method;
  fields.area_id = gd.gd_area_id || "";

  switch (method) {
    case "Self Pickup":
      fields.driver_name = gd.driver_name ?? "";
      fields.ic_no = gd.ic_no ?? "";
      fields.driver_contact_no = gd.driver_contact_no ?? "";
      fields.sp_vehicle_no = gd.sp_vehicle_no ?? "";
      fields.pickup_date = gd.pickup_date ?? "";
      fields.validity_of_collection = gd.validity_of_collection ?? "";
      break;
    case "Courier Service":
      fields.courier_company = gd.courier_company ?? "";
      fields.shipping_date = gd.shipping_date ?? "";
      fields.tracking_number = gd.tracking_number ?? "";
      fields.est_arrival_date = gd.est_arrival_date ?? "";
      fields.freight_charges = gd.freight_charges ?? "";
      break;
    case "Company Truck":
      fields.ct_driver_name = gd.driver_name ?? "";
      fields.ct_driver_contact_no = gd.driver_contact_no ?? "";
      fields.ct_ic_no = gd.ic_no ?? "";
      fields.vehicle_no = gd.sp_vehicle_no ?? "";
      fields.est_delivery_date = gd.est_delivery_date ?? "";
      fields.delivery_cost = gd.delivery_cost ?? "";
      break;
    case "Shipping Service":
      fields.shipping_company = gd.shipping_company ?? "";
      fields.ss_shipping_date = gd.shipping_date ?? "";
      fields.ss_freight_charges = gd.freight_charges ?? "";
      fields.shipping_method = gd.shipping_method ?? "";
      fields.ss_est_arrival_date = gd.est_arrival_date ?? "";
      fields.ss_tracking_number = gd.tracking_number ?? "";
      break;
    case "3rd Party Transporter":
      fields.tpt_vehicle_number = gd.tpt_vehicle_number ?? "";
      fields.tpt_transport_name = gd.tpt_transport_name ?? "";
      fields.tpt_ic_no = gd.tpt_ic_no ?? "";
      fields.tpt_driver_contact_no = gd.tpt_driver_contact_no ?? "";
      fields.tpt_driver_name = gd.tpt_driver_name ?? "";
      break;
  }
  return fields;
};

// For an auto-creation path that's always single-GD, pass [gd]:
//   const deliveryFields = buildDeliveryFields([gd]);
//
// Spread into your Picking payload:
//   const pickingPayload = { ...otherFields, ...deliveryFields };
```

---

## Section visibility on the Picking form (mobile onMounted)

When the Picking form mounts with a pre-filled `delivery_method`, reveal the
matching section and hide the others. Do **not** trigger
`func_reset_delivery_method` — that would wipe the carried-over values.

```javascript
const revealDeliveryMethodSection = async () => {
  const sections = [
    "self_pickup",
    "courier_service",
    "company_truck",
    "shipping_service",
    "third_party_transporter",
  ];
  const deliveryMethod = this.getValue("delivery_method");
  if (!deliveryMethod) {
    await this.hide(sections);
    return;
  }
  const visibilityMap = {
    "Self Pickup": "self_pickup",
    "Courier Service": "courier_service",
    "Company Truck": "company_truck",
    "Shipping Service": "shipping_service",
    "3rd Party Transporter": "third_party_transporter",
  };
  const selected = visibilityMap[deliveryMethod] || null;
  for (const f of sections) {
    if (f === selected) await this.display(f);
    else await this.hide(f);
  }
};
```

Call this in **Add**, **Edit**, and **View** modes after the form is mounted
so saved Pickings also display their section.

---

## Where this is wired on desktop (reference)

The mobile change should mirror these three desktop touchpoints:

| File | Role |
|---|---|
| [Goods Delivery/GDconvertToPicking.json](../Goods%20Delivery/GDconvertToPicking.json) | Bulk "Convert to Picking" workflow. `code_node_PYFZeGpr` builds `pickingData` (returned to the caller, which spreads it into the Picking add-form via `toView`). Helper + `...deliveryFields` spread already added; `response_json` declares all 31 keys (`dlvfld01`..`dlvfld31`). |
| [Goods Delivery/GDheadWorkflow.json](../Goods%20Delivery/GDheadWorkflow.json) | GD save workflow. Under `if_9xhwui06` ("IF Auto Create Picking"), `code_node_o35eZx2c` builds `transferOrderData` and `add_node_rk182M1q` ("Add Picking") inserts it into the Picking collection. Helper + spread added in the code node; 31 prop mappings added on the add node (16 → 47 props). |
| [Picking/PickingLoopWorkflow.json](PickingLoopWorkflow.json) | Picking save workflow (`workflow_id = 2021065804251615233`, called by the Picking form's Save Draft / Save Created / Save Completed buttons). `add_node_j6HU6pFP` ("Add Picking") and `update_node_LKW2Upgf` ("Update Picking") got 31 new prop mappings each (21 → 52, 20 → 51) so the form values actually persist. Sources from `code_node_hjAwTKzF.data.data.<field>` (which is the form's `getValues()`). |
| [Picking/PickingProcessWorkflow.json](PickingProcessWorkflow.json) | Picking-completion sub-workflow (`workflow_id = 2020683258347081730`, called from PickingLoopWorkflow's "Completed" branch). On **Edit → Save Completed**, PickingLoopWorkflow's `update_node_LKW2Upgf` is **skipped** (the `IF !Completed` gate is false) — so this sub-workflow is the ONLY writer. Both `update_node_JBvmArxy` (Picking Plan path) and `update_node_o19MykBA` (Goods Delivery path) got 31 new prop mappings each (5 → 36) sourcing from `{{workflowparams:allData.<field>}}`. Without this, delivery-field edits made on the same save-as-Completed click would silently drop. |
| [Picking/PickingOnMounted.js](PickingOnMounted.js) | Picking add-form. `revealDeliveryMethodSection()` helper added and called in Add/Edit/View. |

### Persistence is wired in two places — do BOTH on mobile

A common gotcha: binding the 30 fields as form models is **not enough** to save
them. The Picking save workflow's add/update nodes must also map each delivery
field, or the form values silently get dropped on save.

For each delivery field, add a prop entry to the mobile Picking save
workflow's "Add Picking" and "Update Picking" nodes, of this shape:

```json
{
  "prop": "<picking_field_name>",
  "operator": "",
  "valueType": "field",
  "value": "{{node:<form-data-node>.data.data.<picking_field_name>}}",
  "valueLabel": "",
  "propLabel": "<human label>"
}
```

For all 30 fields, `prop` and the trailing `.<field>` of `value` use the same
Picking-side field name (the names in the table at the top of this doc). The
`<form-data-node>` is whichever code-node in the mobile save workflow exposes
the raw form values (in the desktop equivalent it's `code_node_hjAwTKzF`
"Data Preparation").

The other two `Update Picking Processing` nodes in the desktop workflow only
flip `is_processing` — they don't need delivery fields. The mobile workflow
likely has the same pattern: only the main create/update nodes need the props.

The collection the desktop Picking writes to is the same one the mobile
Picking should target: **`1935556443668959233`** ("Transfer Order Picking").

---

## Testing checklist

For each scenario, confirm the Picking record is created with the right values
and the right section is visible on the mobile Picking form.

### Single-GD scenarios
- [ ] **Self Pickup**: GD has `gd_delivery_method = "Self Pickup"` with
  `driver_name`, `ic_no`, `driver_contact_no`, `sp_vehicle_no`, `pickup_date`,
  `validity_of_collection`. Convert → Picking has same values in Self Pickup
  section. Section `self_pickup` visible; others hidden.
- [ ] **Courier Service**: GD has `courier_company`, `shipping_date`,
  `tracking_number`, `est_arrival_date`, `freight_charges`. Convert → values
  land in Picking's Courier section. Section `courier_service` visible.
- [ ] **Company Truck**: GD has Company Truck details stored under
  `driver_name`/`driver_contact_no`/`ic_no`/`sp_vehicle_no` (shared names) +
  `est_delivery_date`/`delivery_cost`. Convert → values land in Picking's
  `ct_driver_name` / `ct_driver_contact_no` / `ct_ic_no` / `vehicle_no` /
  `est_delivery_date` / `delivery_cost`. Section `company_truck` visible.
- [ ] **Shipping Service**: GD has `shipping_company` +
  `shipping_date`/`freight_charges`/`est_arrival_date`/`tracking_number`
  (shared names) + `shipping_method`. Convert → values land in Picking's
  `shipping_company` / `ss_shipping_date` / `ss_freight_charges` /
  `shipping_method` / `ss_est_arrival_date` / `ss_tracking_number`. Section
  `shipping_service` visible.
- [ ] **3rd Party Transporter**: GD has `tpt_*` fields. Convert → same `tpt_*`
  fields on Picking. Section `third_party_transporter` visible.
- [ ] **`area_id`**: Picking's `area_id` equals GD's `gd_area_id` in all
  single-GD cases.
- [ ] **`delivery_method_text`**: equals GD's `delivery_method_text`, or the
  method value if the GD didn't store the text.

### Multi-GD scenario
- [ ] Select 2+ GDs → Convert. Picking opens with `delivery_method`,
  `area_id`, `delivery_method_text`, and all 27 detail fields **empty**. No
  section forced open.

### Auto-creation scenario (GD save with `auto_trigger_to = 1`)
- [ ] Save a GD as Created with a delivery method + details. The auto-created
  Picking record has the same delivery fields populated. Open the Picking
  on mobile → the correct section is shown with the values.

### Regression
- [ ] Existing fields still carry over: `so_no`, `delivery_no`, `gd_no`,
  `customer_id`, `plant_id`, `table_picking_items`, HU header rows,
  serial numbers, `ref_doc_type`.
- [ ] Editing or viewing an existing saved Picking still shows its section
  correctly (the on-mount reveal must run in Edit/View too).
