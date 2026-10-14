// PICKING_BULK_COMMIT - P5 gate: the Packing is filled only when the Picking is now Completed (packing_required and
// auto_trigger_pkg were checked from the job); the picked rows per GD, as code_node_pMVdQBEQ derives them, in chunks of
// <= 25 deliveries: each chunk is read, built and written on its own, so no read reaches its limit and an add-node writes <= 25
const CHUNK = 25;
const commitP5Gate = function commitP5Gate(hdrRows, lineRows) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const hdr = list(hdrRows).filter((r) => s(r.id))[0] || null;
  const skip = (why) => ({ route: "SKIP", chunks: [], chunkCount: 0, gdCount: 0, result_message: why });
  if (!hdr) return skip("the Picking was not found");
  if (s(hdr.to_status) !== "Completed") return skip("the Picking is " + s(hdr.to_status) + ": no auto Packing until it is Completed");
  const first = {};
  const hu = {};
  const so = {};
  for (const r of list(lineRows)) {
    if (s(r.item_bundle_id) && !s(r.item_code)) continue;
    if (s(r.line_status) === "Cancelled" || s(r.row_type) === "header") continue;
    const picked = (Number(r.qty_to_pick) || 0) - (Number(r.pending_process_qty) || 0);
    const g = s(r.gd_id);
    if (!(picked > 0) || !g) continue;
    if (!first[g]) first[g] = { so_id: s(r.so_id), so_no: s(r.so_no), gd_no: s(r.gd_no), customer_id: s(r.customer_id) };
    if (s(r.handling_unit_id)) (hu[g] = hu[g] || {})[s(r.handling_unit_id)] = true;
    if (s(r.so_id)) (so[g] = so[g] || {})[s(r.so_id)] = true;
  }
  const gdIds = Object.keys(first).filter((g) => /^[0-9]{1,20}$/.test(g)).sort();
  if (!gdIds.length) return skip("no picked line names a Goods Delivery");
  const chunks = [];
  for (let i = 0; i < gdIds.length; i += CHUNK) {
    const ids = gdIds.slice(i, i + CHUNK);
    const huIds = {};
    const soIds = {};
    const groups = {};
    for (const g of ids) {
      Object.assign(huIds, hu[g] || {});
      Object.assign(soIds, so[g] || {});
      groups[g] = first[g];
    }
    chunks.push({ gdIds: ids, huIds: Object.keys(huIds).length ? Object.keys(huIds) : ["0"], soIds: Object.keys(soIds).length ? Object.keys(soIds) : ["0"], groups: groups });
  }
  return { route: "GO", chunks: chunks, chunkCount: chunks.length, gdCount: gdIds.length, result_message: gdIds.length + " Goods Delivery(ies) to pack in " + chunks.length + " chunk(s)" };
};
const res = commitP5Gate([{{node:sql_node_PCp5hdr.data}}][0], [{{node:sql_node_PCp5lines.data}}][0]);
console.log("commit P5 gate", JSON.stringify({ route: res.route, gds: res.gdCount, chunks: res.chunkCount, message: res.result_message }));
return res;
