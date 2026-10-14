// PICKING_BULK_COMMIT - P1 merge: the Picking as stored NOW + the prepared pick -> the one Picking update (code_node_Z5JH4g2u
// on the stored tree). Records already carrying this job's job_line_key are kept, never added twice, so a re-run after a
// partial write converges; line and header values are absolute.
const commitP1Merge = function commitP1Merge(entry, payloadRows, fresh) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const HEADER_FIELDS = ["ref_doc", "remarks", "remarks_2", "remarks_3", "delivery_method", "delivery_method_text", "area_id",
    "driver_name", "ic_no", "driver_contact_no", "sp_vehicle_no", "pickup_date", "validity_of_collection", "courier_company",
    "shipping_date", "tracking_number", "est_arrival_date", "freight_charges", "ct_driver_name", "ct_driver_contact_no", "ct_ic_no",
    "vehicle_no", "est_delivery_date", "delivery_cost", "shipping_company", "ss_shipping_date", "ss_freight_charges",
    "shipping_method", "ss_est_arrival_date", "ss_tracking_number", "tpt_vehicle_number", "tpt_transport_name", "tpt_ic_no",
    "tpt_driver_contact_no", "tpt_driver_name", "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no",
    "di_shipping_company", "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date",
    "di_pickup_date", "di_validity_of_collection", "di_tracking_number", "di_freight_charges", "project_id"];
  const p = JSON.parse(s((list(payloadRows)[0] || {}).prepared_payload));
  const got = fresh && typeof fresh === "object" ? fresh : {};
  const doc = Array.isArray(got.data) ? got.data[0] : got.data;
  const base = { route: "FAIL", pickRows: [], needWrite: "NO", added: 0, kept: 0, toStatus: "", result_code: "", result_message: "" };
  if (!doc || s(doc.id) !== s(entry.pickingId)) return Object.assign(base, { result_code: "PK_INVALID_DATA", result_message: "Picking " + entry.pickingId + " could not be read" });

  // the tree, flat with refs back to where each row sits (code_node_Z5JH4g2u)
  const tree = Array.isArray(doc.table_picking_items) ? doc.table_picking_items : [];
  const flat = [];
  const refs = [];
  tree.forEach((row, parent) => {
    flat.push(row);
    refs.push({ parent: parent, child: null });
    (Array.isArray(row.children) ? row.children : []).forEach((child, childIndex) => {
      flat.push(child);
      refs.push({ parent: parent, child: childIndex });
    });
  });
  const updatedFlat = flat.map((row) => {
    const patch = p.row_patch[s(row.id)];
    return patch ? Object.assign({}, row, patch) : Object.assign({}, row, { line_status: row.line_status || "Open" });
  });
  // authoritative packing qty + net weight from each line's qty_to_pick
  updatedFlat.forEach((it) => {
    const qtyToPick = parseFloat(it.qty_to_pick) || 0;
    const packingConversion = parseFloat(it.packing_conversion) || 1;
    const weightConversion = parseFloat(it.weight_conversion) || 0;
    it.packing_qty = Math.round((qtyToPick / packingConversion) * 1000) / 1000;
    it.net_weight = Math.round(qtyToPick * weightConversion * 1000) / 1000;
  });
  const out = tree.map((row) => Object.assign({}, row));
  refs.forEach((ref, index) => {
    const rest = Object.assign({}, updatedFlat[index]);
    delete rest.children;
    if (ref.child === null) {
      out[ref.parent] = Object.assign({}, out[ref.parent], rest);
      return;
    }
    const parent = out[ref.parent] || {};
    const children = Array.isArray(parent.children) ? parent.children.slice() : [];
    children[ref.child] = Object.assign({}, children[ref.child], updatedFlat[index]);
    out[ref.parent] = Object.assign({}, parent, { children: children });
  });

  // ITEM BUNDLES - the bundle row follows its items (code_node_Z5JH4g2u)
  for (const bundleRow of out.filter((i) => i && i.row_type !== "header" && i.item_bundle_id && !i.item_code)) {
    if (bundleRow.line_status === "Cancelled") continue;
    const nested = Array.isArray(bundleRow.children) ? bundleRow.children : [];
    const bundleRowId = String(bundleRow.id || "");
    const flatParts = bundleRowId ? out.filter((i) => i && String(i.parent_id || "") === bundleRowId) : [];
    const allParts = nested.length > 0 ? nested : flatParts;
    const parts = allParts.filter((i) => i && i.line_status !== "Cancelled");
    if (allParts.length > 0 && parts.length === 0) {
      bundleRow.line_status = "Cancelled";
      bundleRow.pending_process_qty = 0;
      continue;
    }
    if (parts.length === 0) continue;
    const worst = parts.reduce((w, part) => {
      const planned = parseFloat(part.qty_to_pick) || 0;
      const left = parseFloat(part.pending_process_qty) || 0;
      const share = planned > 0 ? left / planned : 0;
      return share > w ? share : w;
    }, 0);
    bundleRow.pending_process_qty = q8((parseFloat(bundleRow.qty_to_pick) || 0) * worst);
    const anyStarted = parts.some((part) => (parseFloat(part.pending_process_qty) || 0) < (parseFloat(part.qty_to_pick) || 0));
    if (bundleRow.pending_process_qty === 0) bundleRow.line_status = "Completed";
    else if (anyStarted) bundleRow.line_status = "In Progress";
    else bundleRow.line_status = "Open";
  }

  const nonCancelled = out.filter((i) => i.line_status !== "Cancelled" && i.row_type !== "header");
  const completed = nonCancelled.filter((i) => i.line_status === "Completed").length;
  const inProgress = nonCancelled.filter((i) => i.line_status === "In Progress").length;
  const toStatus = completed === nonCancelled.length && nonCancelled.length > 0 ? "Completed" : completed > 0 || inProgress > 0 ? "In Progress" : "Open";

  const stored = Array.isArray(doc.table_picking_records) ? doc.table_picking_records : [];
  const have = {};
  for (const r of stored) if (s(r.job_line_key)) have[s(r.job_line_key)] = true;
  const toAdd = p.records.filter((r) => !have[s(r.job_line_key)]);
  const hp = p.header_patch || {};
  const pick = { id: s(doc.id), to_status: toStatus, table_picking_items: out, table_picking_records: stored.concat(toAdd) };
  for (const k of HEADER_FIELDS) pick[k] = Object.prototype.hasOwnProperty.call(hp, k) ? hp[k] : doc[k] === undefined ? null : doc[k];
  return Object.assign(base, { route: "WRITE", pickRows: [pick], needWrite: "YES", added: toAdd.length, kept: p.records.length - toAdd.length, toStatus: toStatus, result_message: toAdd.length + " record(s) to add, " + (p.records.length - toAdd.length) + " already written; Picking " + toStatus });
};
const entry = [{{node:code_node_PCentry.data}}][0];
const res = commitP1Merge(entry, [{{node:sql_node_PCpayload.data}}][0], [{{node:get_node_PCp1get.data}}][0]);
console.log("commit P1 merge", JSON.stringify({ route: res.route, added: res.added, kept: res.kept, toStatus: res.toStatus, message: res.result_message }));
return res;
