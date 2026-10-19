const partialList = {{node:code_node_pMVdQBEQ.data.packingDataList}} || [];
const huMasters = {{node:search_node_mUPqqQph.data.data}} || [];
const soMasters = {{node:search_node_i5v6z7Hu.data.data}} || [];
const gdMasters = {{node:search_node_c7BtNx91.data.data}} || [];
const existingPackings = {{node:search_node_FXknErTg.data.data}} || [];

const huById = {};
for (const h of huMasters) huById[h.id] = h;

const soById = {};
for (const s of soMasters) soById[s.id] = s;

const gdById = {};
for (const g of gdMasters) gdById[g.id] = g;

// Delivery Info is resolved per Packing in code_node_pMVdQBEQ; both the create
// and the update path carry it through unchanged.
const DELIVERY_INFO_KEYS = [
  "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no",
  "di_shipping_company", "di_transport_name", "di_vehicle_number",
  "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date",
  "di_validity_of_collection", "di_tracking_number", "di_freight_charges",
];
const pickDeliveryInfo = (p) => {
  const fields = {};
  for (const k of DELIVERY_INFO_KEYS) fields[k] = p[k] ?? "";
  return fields;
};

// One existing Packing per gd_id (1 GD ↔ 1 Packing invariant). If multiple
// non-terminal Packings exist for the same gd_id (shouldn't happen but
// defensive), we take the first.
const existingByGdId = {};
for (const p of existingPackings) {
  if (p.gd_id && !existingByGdId[p.gd_id]) {
    existingByGdId[p.gd_id] = p;
  }
}

const packingsToCreate = [];
const packingsToUpdate = [];

for (const p of partialList) {
  const huItems = p.huItemsPartial || [];
  const distinctHuIds = [];
  const seen = {};
  for (const it of huItems) {
    if (!seen[it.handling_unit_id]) {
      seen[it.handling_unit_id] = true;
      distinctHuIds.push(it.handling_unit_id);
    }
  }

  // HU rows = full GD-allocation projection. Header status inherits from its
  // items: "Unpacked" only when EVERY item is upstream-picked, else "Pending".
  // The pick handlers gate on the HEADER, so `some` let a part-picked HU carry
  // its still-unpicked items into the Packing.
  const newHuRows = [];
  for (const huId of distinctHuIds) {
    const hu = huById[huId] || {};
    const itemsForHu = huItems.filter(function(it) { return it.handling_unit_id === huId; });
    const headerStatus = itemsForHu.every(function(it) { return it.hu_status === "Unpacked"; })
      ? "Unpacked"
      : "Pending";
    newHuRows.push({
      row_type: "header",
      handling_unit_id: huId,
      handling_no: hu.handling_no || "",
      hu_material_id: hu.hu_material_id || "",
      hu_type: hu.hu_type || "",
      hu_uom: hu.hu_uom || "",
      hu_status: headerStatus,
      storage_location: hu.storage_location || "",
      gross_weight: hu.gross_weight || 0,
      net_weight: hu.net_weight || 0,
      net_volume: hu.net_volume || 0
    });
    for (const it of itemsForHu) newHuRows.push(it);
  }

  const so = soById[p.so_id] || {};
  const gd = gdById[p.gd_id] || {};
  const existing = existingByGdId[p.gd_id] || null;

  // No GD master, or nothing loose and no HU rows: a create would be empty, an update a wipe.
  if (!gdById[p.gd_id] || ((p.table_item_source || []).length === 0 && newHuRows.length === 0)) continue;

  if (existing) {
    // No GD master means table_item_source was built from nothing; writing it
    // back would wipe the lines this Packing already has. Leave it untouched.
    if (!gdById[p.gd_id]) continue;

    // UPDATE path: rebuild table_item_source from GD (cumulative picks),
    // merge table_hu_source with existing rows. Skip duplicate HU headers.
    const existingHuSource = Array.isArray(existing.table_hu_source) ? existing.table_hu_source : [];
    const existingHuIds = {};
    for (const r of existingHuSource) {
      if (r.row_type === "header" && r.handling_unit_id) {
        existingHuIds[r.handling_unit_id] = true;
      }
    }
    const mergedHuSource = existingHuSource.slice();
    for (const r of newHuRows) {
      if (r.row_type === "header" && existingHuIds[r.handling_unit_id]) continue;
      if (r.row_type === "header") existingHuIds[r.handling_unit_id] = true;
      mergedHuSource.push(r);
    }

    // Keep each surviving row's OWN id. The rows are rebuilt from the GD every
    // time, but PackingRecomputeSource.js matches HU temp_data back to a source
    // row through line_item_id === row.id, so regenerating ids would orphan
    // everything already picked into a handling unit. Matched on the business key
    // the row carries; a genuinely new row goes across with no id and the
    // platform mints one, exactly as it does on create.
    const srcKey = (r) =>
      String(r.gd_line_id == null ? "" : r.gd_line_id) + "|" +
      String(r.bin_location == null ? "" : r.bin_location) + "|" +
      String(r.batch_no == null ? "" : r.batch_no);

    const existingSrcId = {};
    for (const r of (Array.isArray(existing.table_item_source) ? existing.table_item_source : [])) {
      const k = srcKey(r);
      if (r.id && !existingSrcId[k]) existingSrcId[k] = r.id;
    }
    const rebuiltSrc = (p.table_item_source || []).map((r) => {
      const keep = existingSrcId[srcKey(r)];
      return keep ? Object.assign({}, r, { id: keep }) : r;
    });

    packingsToUpdate.push({
      existing_packing_id: existing.id,
      gd_id: p.gd_id,
      table_item_source: rebuiltSrc,
      table_hu_source: mergedHuSource,
      ...pickDeliveryInfo(p)
    });
  } else {
    // CREATE path: full payload for the existing add-node
    packingsToCreate.push({
      plant_id: gd.plant_id || p.plant_id,
      organization_id: gd.organization_id || p.organization_id,
      packing_mode: p.packing_mode,
      created_by: p.created_by,
      created_at: p.created_at,
      gd_id: Array.isArray(p.gd_id) ? (p.gd_id.filter(Boolean)[0] || "") : (p.gd_id || ""),
      gd_no: gd.delivery_no || p.gd_no,
      so_id: (function(){ var v = gd.so_id; if (Array.isArray(v) && v.length === 0) v = null; v = v || p.so_id; return Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []); })(),
      so_no: gd.so_no || p.so_no,
      to_id: Array.isArray(p.to_id) ? (p.to_id.filter(Boolean)[0] || "") : (p.to_id || ""),
      customer_id: (function(){ var c = gd.customer_name || (Array.isArray(p.customer_id) ? p.customer_id.filter(Boolean)[0] : p.customer_id) || so.customer_name; if (Array.isArray(c)) c = c.filter(Boolean)[0]; return c ? [c] : []; })(),
      billing_address: gd.gd_billing_address || so.cust_billing_address || "",
      shipping_address: gd.gd_shipping_address || so.cust_shipping_address || "",
      remarks: gd.order_remark || p.remarks || "",
      remarks_2: gd.order_remark2 || p.remarks_2 || "",
      remarks_3: gd.order_remark3 || p.remarks_3 || "",
      ...pickDeliveryInfo(p),
      table_item_source: p.table_item_source,
      table_hu_source: newHuRows
    });
  }
}

// packingsToUpdate is the FULL ARRAY. A multi-GD Picking (the M:N split) can
// carry several GDs whose Packing already exists, so loop_PackingUpdates walks
// them and the update-node reads each item's fields off that loop node.
// Taking [0] here silently dropped every Packing after the first.

return {
  packingsToCreate: packingsToCreate,
  packingsToUpdate: packingsToUpdate,
  hasCreates: packingsToCreate.length > 0 ? 1 : 0,
  hasUpdates: packingsToUpdate.length > 0 ? 1 : 0,
  // Backward-compat alias of packingsToCreate:
  packingDataList: packingsToCreate
};
