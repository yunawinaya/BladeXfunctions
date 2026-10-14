// GD_COMPLETE_COMMIT - C5 plan: the GD part's patches on the GD as stored (raw, so a "" stays ""): the changed lines in
// slices (the 14 columns the Completed path sets on a line) and the header (gd_status Completed + the 4 it can change)
const GC_LINE_COLS = ["prev_temp_qty_data", "customer_id", "organization_id", "plant_id", "billing_state_id", "billing_country_id", "shipping_state_id",
  "shipping_country_id", "assigned_to", "area_id", "line_index", "gd_undelivered_qty", "packing_qty", "net_weight"];
const DEC = { gd_total: 1, gd_undelivered_qty: 1, packing_qty: 1, net_weight: 1 };
const JSONC = { so_id: 1, assigned_to: 1 };
const cell = function cell(c, v) {
  if (v === undefined || v === null) return null;
  if (DEC[c]) return v === "" ? null : q8(v).toFixed(8);
  if (JSONC[c]) {
    if (typeof v === "string") { const p = parseJ(v); return p === null ? null : p; }
    return v;
  }
  return v;
};
const commitC5Plan = function commitC5Plan(entry, partRows, rawRows) {
  const base = { route: "GO", headerRows: [], soRows: [], needSoHead: "NO", lineSlices: [], lineCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const gd = joinChunks(partRows, entry.partPrefix + "GD|");
  if (!gd) return Object.assign(base, stepEnd(entry, "C5_GD", "the delivery part of the prepared payload is missing", true));
  let head = null;
  const raw = {};
  for (const r of list(rawRows)) {
    const o = parseJ(r.j);
    if (!o) continue;
    if (s(r.k) === "H") head = o;
    else raw[s(o.id)] = o;
  }
  if (!head) return Object.assign(base, stepEnd(entry, "C5_GD", "the Goods Delivery cannot be read", true));
  const hp = gd.header || {};
  // gd_status / gd_total / picking_status always; so_id / so_no (a JSON id list) only when the fill-back changed them
  const hrow = { id: entry.gdId };
  for (const c of ["gd_total", "picking_status"]) hrow[c] = cell(c, c in hp ? hp[c] : head[c]);
  hrow.gd_status = "Completed";
  const soRow = "so_id" in hp || "so_no" in hp ? [{ id: entry.gdId, so_id: cell("so_id", "so_id" in hp ? hp.so_id : head.so_id), so_no: cell("so_no", "so_no" in hp ? hp.so_no : head.so_no) }] : [];
  const rows = [];
  const gone = [];
  for (const p of gd.lines || []) {
    const cur = raw[s(p.id)];
    if (!cur) { gone.push(s(p.id)); continue; }
    const row = { id: s(p.id) };
    for (const c of GC_LINE_COLS) row[c] = cell(c, c in p ? p[c] : cur[c]);
    rows.push(row);
  }
  if (gone.length) return Object.assign(base, stepEnd(entry, "C5_GD", gone.length + " delivery line(s) vanished (e.g. " + gone.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { headerRows: [hrow], soRows: soRow, needSoHead: soRow.length ? "YES" : "NO", lineSlices: slicesOf(rows, 250), lineCount: rows.length,
    result_message: rows.length + " line(s) + the header to write" });
};
const res = commitC5Plan([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc5part.data}}][0], [{{node:sql_node_CCc5raw.data}}][0]);
console.log("commit C5 plan", JSON.stringify({ route: res.route, lines: res.lineCount, result: res.result_code, message: res.result_message }));
return res;
