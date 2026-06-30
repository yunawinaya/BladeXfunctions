// Assemble the minimal snapshot payload from search results.
const soLines = {{node:search_node_K8tDhBp1.data.data}} || [];
const soHeaders = {{node:search_node_csSoHdr01.data.data}} || [];
const allocatedReserved = {{node:search_node_NPrwt0qv.data.data}} || [];
const pendingReserved = {{node:search_node_8xeGAzs2.data.data}} || [];
const pickingRecords = {{node:search_node_FYpwfTbu.data.data}} || [];
const ppHeaders = {{node:search_node_VCdHgKjQ.data.data}} || [];
const huList = {{node:search_node_LmqRjzFE.data.data}} || [];
const huLines = {{node:search_node_oUkPx4Vi.data.data}} || [];

const toNum = (v) => parseFloat(v || 0);
const asArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));

// pre_so_lines: SO line state pre-completion (id + qty fields + line_status).
const pre_so_lines = asArray(soLines).map((r) => ({
  id: r.id,
  planned_qty: toNum(r.planned_qty),
  delivered_qty: toNum(r.delivered_qty),
  outstanding_quantity: toNum(r.outstanding_quantity),
  line_status: r.line_status || "",
}));

// pre_so_headers: SO header state pre-completion. Completion's update_node_AFswLv4E
// rewrites so_status (Processing/Completed), gd_status on SO header
// (Partially Delivered / Fully Delivered), and the partially_delivered /
// fully_delivered count strings. Revert restores all four.
const pre_so_headers = asArray(soHeaders).map((h) => ({
  id: h.id,
  so_status: h.so_status != null ? h.so_status : "",
  gd_status: h.gd_status != null ? h.gd_status : "",
  partially_delivered: h.partially_delivered != null ? String(h.partially_delivered) : "",
  fully_delivered: h.fully_delivered != null ? String(h.fully_delivered) : "",
}));

// pre_pending_state: minimal Pending state for merge-delta detection at revert.
const pre_pending_state = asArray(pendingReserved).map((r) => ({
  id: r.id,
  reserved_qty: toNum(r.reserved_qty),
  open_qty: toNum(r.open_qty),
}));

// pre_on_reserved_gd_ids: ALL ids in scope (allocated targeting this GD + pending in scope).
// Used by revert for mark-and-sweep fragment detection.
const pre_on_reserved_gd_ids = [
  ...asArray(allocatedReserved).map((r) => r.id),
  ...asArray(pendingReserved).map((r) => r.id),
];

// pp_restamp_map: capture original PP linkage for PP-sourced Allocated records.
// Completion's processDeliveredAllocation rewrites these to GD identity on full-take.
//
// Only the PP lines THIS GD actually delivers get restamped. When the Picking
// Plan has more lines than the GD (e.g. PP has 2 lines, GD delivers only line 1),
// the extra PP reservations stay on the plan and are never restamped. Recording
// them here would make revert raise a false pp_restamp_missing conflict, so skip
// PP reservations still targeting the plan header whose line is absent from this
// GD. Records already targeting the GD (Edit-mode) are left untouched.
const _snapAllData = {{workflowparams:allData}} || {};
const _snapTableGd = Array.isArray(_snapAllData.table_gd) ? _snapAllData.table_gd : [];
const gdPpLineSet = new Set(
  _snapTableGd.map((it) => (it && it.pp_line_item_id ? String(it.pp_line_item_id) : null)).filter(Boolean)
);
const gdPpHeaderSet = new Set(
  _snapTableGd.map((it) => (it && it.line_pp_id ? String(it.line_pp_id) : null)).filter(Boolean)
);
const pp_restamp_map = {};
for (const r of asArray(allocatedReserved)) {
  if (r.doc_type === "Picking Plan") {
    const targetsPpHeader = gdPpHeaderSet.has(String(r.target_gd_id));
    if (targetsPpHeader && !gdPpLineSet.has(String(r.doc_line_id))) continue;
    pp_restamp_map[r.id] = {
      doc_type: r.doc_type,
      doc_id: r.doc_id || "",
      doc_no: r.doc_no || "",
      doc_line_id: r.doc_line_id || "",
      target_gd_id: r.target_gd_id || "",
    };
  }
}

// pre_picking_records: reserved/delivered stamps that completion will adjust.
// transfer_order_id is the FK from a picking record to its Transfer Order Picking header.
const pre_picking_records = asArray(pickingRecords).map((r) => ({
  id: r.id,
  header_id: r.transfer_order_id || "",
  reserved_qty: toNum(r.reserved_qty),
  delivered_qty: toNum(r.delivered_qty),
}));

// pre_pp_headers: header delivery_status that may flip to Completed.
const pre_pp_headers = asArray(ppHeaders).map((h) => ({
  id: h.id,
  delivery_status: h.delivery_status || "",
}));

// pre_hu_state: HU totals + per-line item_handling_unit quantities.
const pre_hu_state = {
  hus: asArray(huList).map((h) => ({
    id: h.id,
    total_quantity: toNum(h.total_quantity),
  })),
  lines: asArray(huLines).map((l) => ({
    id: l.id,
    handling_unit_id: l.handling_unit_id || "",
    material_id: l.material_id || "",
    batch_id: l.batch_id || null,
    quantity: toNum(l.quantity),
  })),
};

return {
  pre_so_lines: JSON.stringify(pre_so_lines),
  pre_so_headers: JSON.stringify(pre_so_headers),
  pre_pending_state: JSON.stringify(pre_pending_state),
  pre_on_reserved_gd_ids: JSON.stringify(pre_on_reserved_gd_ids),
  pre_picking_records: JSON.stringify(pre_picking_records),
  pre_pp_headers: JSON.stringify(pre_pp_headers),
  pre_hu_state: JSON.stringify(pre_hu_state),
  pp_restamp_map: JSON.stringify(pp_restamp_map),
};
