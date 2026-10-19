// table_picking_items / updatedItems is a TREE: an item bundle is ONE row with the
// items under it as `children`. A row with no `children` yields just itself, so a
// document with no bundles is unaffected.
const flattenPickingRows = (rows) =>
  (rows || []).flatMap((row) => [
    row,
    ...(Array.isArray(row.children) ? row.children : []),
  ]);

// table_gd is a SECOND tree, and a different one: it comes from the Goods Delivery
// MASTER, so a bundle is one parent row carrying its real lines under `children`.
// Mirrors code_node_B3E0xodz, which reads the same fetch.
const flattenGdRows = (rows) =>
  (rows || []).flatMap((row) => {
    const { children, ...rest } = row || {};
    return [rest, ...(Array.isArray(children) ? children : [])];
  });

const packingSetup = {{node:get_node_V4PP8WJI.data.data}} || null;
const _opd = {{node:get_node_jEllcWiJ.data.data}};
const originalPicking = (Array.isArray(_opd) ? _opd[0] : _opd) || {};
const toStatus = {{node:code_node_Z5JH4g2u.data.toStatus}};
const pickingData = {{workflowparams:allData}};
const updatedItems = {{node:code_node_Z5JH4g2u.data.updatedItems}};
const sessionRecords = {{node:code_node_oHIIKfiw.data.records}} || [];
const gdMasters = {{node:search_node_c7BtNx91.data.data}} || [];

const shouldTriggerAutoPacking =
  packingSetup &&
  packingSetup.packing_required === 1 &&
  packingSetup.auto_trigger_pkg === 1 &&
  toStatus === "Completed";

if (!shouldTriggerAutoPacking) {
  return { shouldTriggerAutoPacking: 0, packingDataList: [], huIdsAcrossGDs: [], soIdsAcrossGDs: [] };
}

// Derive picked rows in this Picking session. Used for: (1) discovering which
// GDs were touched, (2) building HU rows from THIS Picking's records.
const pickedRows = [];
for (const r of flattenPickingRows(updatedItems)) {
  // The bundle row is not packable -- it carries no item, and the quantity on it is
  // a number of bundles, not of anything that goes in a box. Its items are the rows
  // that get packed, and reading the top level alone would have taken the bundle row
  // and missed them entirely.
  if (r.item_bundle_id && !r.item_code) continue;
  if (r.line_status === "Cancelled") continue;

  const qtyToPick = Number(r.qty_to_pick) || 0;
  const pending = Number(r.pending_process_qty) || 0;
  const picked = qtyToPick - pending;
  if (picked > 0 && r.gd_id) {
    pickedRows.push(Object.assign({}, r, { _picked_qty: picked }));
  }
}

const groups = {};
for (const r of pickedRows) {
  if (!groups[r.gd_id]) groups[r.gd_id] = [];
  groups[r.gd_id].push(r);
}

const gdIds = Object.keys(groups);
if (gdIds.length === 0) {
  return { shouldTriggerAutoPacking: 0, packingDataList: [], huIdsAcrossGDs: [], soIdsAcrossGDs: [] };
}

const huIdSet = {};
const soIdSet = {};
for (const r of pickedRows) {
  if (r.handling_unit_id) huIdSet[r.handling_unit_id] = true;
  if (r.so_id) soIdSet[r.so_id] = true;
}
const huIdsAcrossGDs = Object.keys(huIdSet);
const soIdsAcrossGDs = Object.keys(soIdSet);

const gdById = {};
for (const g of gdMasters) gdById[g.id] = g;

// Delivery Info carried onto each Packing. Packing only has the consolidated
// di_* block, and GD / Picking / Packing all share those column names, so they
// copy straight across. Mirrors the single-source rule in the GD -> Picking
// convert (gdPicking_workflow.json): a Picking built from exactly ONE GD holds
// that GD's Delivery Info (possibly edited on the Picking), so its values win;
// a Picking spanning several GDs leaves every field empty, so each Packing --
// always 1 GD <-> 1 Packing -- takes its own GD's values instead.
const DELIVERY_INFO_KEYS = [
  "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no",
  "di_shipping_company", "di_transport_name", "di_vehicle_number",
  "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date",
  "di_validity_of_collection", "di_tracking_number", "di_freight_charges",
];

const buildDeliveryInfo = (source) => {
  const fields = {};
  for (const k of DELIVERY_INFO_KEYS) fields[k] = (source && source[k]) ?? "";
  return fields;
};

const pickingGdIds = Array.isArray(pickingData.gd_no)
  ? [...new Set(pickingData.gd_no.filter(Boolean).map(String))]
  : [];
const pickingIsSingleGd = pickingGdIds.length === 1;

// Build one packingData entry per GD. table_item_source is a projection of
// the GD's table_gd (one row per GD line) with total_quantity set to the
// cumulative picked_qty (set by code_node_iES7iMKA's M:N writeback). HU rows
// come from THIS Picking's records — the merge with any existing Packing's
// table_hu_source happens in code_node_gudzrvMQ.
const packingDataList = gdIds.map(function(gdId) {
  const gd = gdById[gdId] || {};
  const tableGd = Array.isArray(gd.table_gd) ? gd.table_gd : [];
  const rows = groups[gdId];
  const anyRow = rows[0];

  // Iterate every GD line's temp_qty_data — that's the FULL allocation. Each
  // entry becomes a row in either table_item_source (loose, no HU) or
  // huItemsPartial (HU-bound; later turned into table_hu_source by gudzrvMQ).
  // picked_qty per row seeds from gd_line.picked_temp_qty_data so the user
  // sees what's been picked from upstream Pickings.
  const table_item_source = [];
  const huItemsPartial = [];
  const parseJsonSafe = function(s) {
    try { return s ? JSON.parse(s) : []; } catch (e) { return []; }
  };

  for (const line of flattenGdRows(tableGd)) {
    if (!line.material_id) continue;
    if (line.picking_status === "Cancelled") continue;

    const tempArr = parseJsonSafe(line.temp_qty_data);
    const pickedArr = parseJsonSafe(line.picked_temp_qty_data);
    if (!Array.isArray(tempArr) || tempArr.length === 0) continue;

    const keyOf = function(e) {
      return (e.location_id || "no-loc") + "_" +
             (e.batch_id || "no-batch") + "_" +
             (e.handling_unit_id || "no-hu");
    };
    // search_node_c7BtNx91 runs AFTER update_node_JXfFIqqv and update_node_MNPicked,
    // so picked_temp_qty_data is already cumulative INCLUDING this Picking — adding
    // sessionRecords on top counted this session's picks twice. That column is only
    // ever written when allow_full_picking is on, so this session's records stay the
    // source for the single-Picking flow, where it is always empty.
    const pickedByKey = {};
    const pickedEntries = Array.isArray(pickedArr) ? pickedArr : [];
    if (pickedEntries.length > 0) {
      for (const p of pickedEntries) {
        const k = keyOf(p);
        pickedByKey[k] = (pickedByKey[k] || 0) + (Number(p.gd_quantity) || 0);
      }
    } else {
      for (const rec of sessionRecords) {
        if (String(rec.gd_line_id) !== String(line.id)) continue;
        const recKey = (rec.target_location || rec.source_bin || "no-loc") + "_" +
                       (rec.target_batch || rec.batch_no || "no-batch") + "_" +
                       (rec.handling_unit_id || "no-hu");
        pickedByKey[recKey] = (pickedByKey[recKey] || 0) + (Number(rec.store_out_qty) || 0);
      }
    }

    for (const t of tempArr) {
      const allocated = Number(t.gd_quantity) || 0;
      if (allocated <= 0) continue;

      const k = keyOf(t);
      const pickedQty = pickedByKey[k] || 0;
      const remainingQty = Math.max(0, allocated - pickedQty);

      if (t.handling_unit_id) {
        // HU-bound: goes to table_hu_source via huItemsPartial.
        // Status: "Unpacked" if upstream has picked it, else "Pending".
        huItemsPartial.push({
          row_type: "item",
          handling_unit_id: t.handling_unit_id,
          id: line.id || "",
          item_id: t.material_id || line.material_id,
          item_code: t.material_id || line.material_id,
          item_name: line.material_name,
          item_desc: line.gd_material_desc || "",
          item_uom: line.good_delivery_uom_id || line.gd_order_uom_id || "",
          batch_no: t.batch_id || "",
          bin_location: t.location_id || "",
          total_quantity: allocated,
          hu_status: pickedQty >= allocated - 0.001 ? "Unpacked" : "Pending",
          remark: line.line_remark_1 || "",
          remark_2: line.line_remark_2 || "",
          remark_3: line.line_remark_3 || "",
          so_id: line.line_so_id || "",
          so_no: line.line_so_no || "",
          so_line_id: line.so_line_item_id || "",
          gd_id: gdId,
          gd_no: gd.delivery_no || "",
          gd_line_id: line.id || "",
          to_id: pickingData.id || "",
          to_line_id: ""
        });
      } else {
        // Loose: goes to table_item_source. One row per (line, bin, batch).
        table_item_source.push({
          item_id: line.material_id,
          item_code: line.material_id,
          item_name: line.material_name,
          item_desc: line.gd_material_desc || "",
          item_uom: line.good_delivery_uom_id || line.gd_order_uom_id || "",
          batch_no: t.batch_id || "",
          bin_location: t.location_id || "",
          total_quantity: allocated,
          picked_qty: pickedQty,
          remaining_qty: remainingQty,
          qty_to_pick: remainingQty,
          line_status: pickedQty <= 0 ? "Open" : (remainingQty <= 0.001 ? "Fully Picked" : "Partially Picked"),
          remark: line.line_remark_1 || "",
          remark_2: line.line_remark_2 || "",
          remark_3: line.line_remark_3 || "",
          so_id: line.line_so_id || anyRow.so_id || "",
          so_no: line.line_so_no || anyRow.so_no || "",
          so_line_id: line.so_line_item_id || "",
          gd_id: gdId,
          gd_no: gd.delivery_no || anyRow.gd_no || "",
          gd_line_id: line.id || "",
          to_id: pickingData.id || "",
          to_line_id: ""
        });
      }
    }
  }

  const deliveryInfo = buildDeliveryInfo(pickingIsSingleGd ? pickingData : gd);

  return {
    plant_id: gd.plant_id || pickingData.plant_id,
    // allData carries no organization_id (mobile omits it), so fall back to
    // the stored Picking before giving up.
    organization_id: gd.organization_id || originalPicking.organization_id || pickingData.organization_id || packingSetup.organization_id,
    packing_mode: packingSetup.packing_mode || "",
    created_by: pickingData.created_by,
    created_at: new Date().toISOString().split("T")[0],
    gd_id: gdId,
    gd_no: gd.delivery_no || anyRow.gd_no,
    so_id: gd.so_id || anyRow.so_id,
    so_no: gd.so_no || anyRow.so_no,
    to_id: pickingData.id || "",
    // Per-GD customer. pickingData.customer_id spans EVERY GD in this Picking,
    // so it is only usable when the Picking has exactly one customer.
    customer_id: (function () {
      const pickCust = Array.isArray(pickingData.customer_id)
        ? pickingData.customer_id.filter(Boolean)
        : (pickingData.customer_id ? [pickingData.customer_id] : []);
      const c = gd.customer_name || anyRow.customer_id || (pickCust.length === 1 ? pickCust[0] : null);
      return c ? [c] : [];
    })(),
    remarks: gd.order_remark || "",
    remarks_2: gd.order_remark2 || "",
    remarks_3: gd.order_remark3 || "",
    ...deliveryInfo,
    table_item_source: table_item_source,
    huItemsPartial: huItemsPartial
  };
});
return {
  shouldTriggerAutoPacking: 1,
  packingDataList: packingDataList,
  huIdsAcrossGDs: huIdsAcrossGDs,
  soIdsAcrossGDs: soIdsAcrossGDs
};
