// GD_CANCEL_COMMIT - X6 THE GD: the GD part's patches on the GD as stored (raw, so a "" stays ""): the changed lines in slices and
// the header - gd_status Cancelled (the GD stops being Processing here), the "-Cancelled" number, picking_status, gd_total
const GX6_LINE_COLS = ["prev_temp_qty_data", "customer_id", "organization_id", "plant_id", "billing_state_id", "billing_country_id", "shipping_state_id",
  "shipping_country_id", "assigned_to", "area_id", "line_index", "gd_undelivered_qty", "packing_qty", "net_weight", "picking_status", "packing_status"];
const GX6_DEC = { gd_total: 1, gd_undelivered_qty: 1, packing_qty: 1, net_weight: 1 };
const GX6_JSON = { so_id: 1, assigned_to: 1 };
const gx6Cell = function gx6Cell(c, v) {
  if (v === undefined || v === null) return null;
  if (GX6_DEC[c]) return v === "" ? null : q8(v).toFixed(8);
  if (GX6_JSON[c]) {
    if (typeof v === "string") {
      const p = parseJ(v);
      return p === null ? null : p;
    }
    return v;
  }
  return v;
};
const gx6Raw = function gx6Raw(rows) {
  let head = null;
  const raw = {};
  for (const r of list(rows)) {
    const o = parseJ(r.j);
    if (!o) continue;
    if (s(r.k) === "H") head = o;
    else raw[s(o.id)] = o;
  }
  return { head: head, raw: raw };
};
const cancelX6Plan = function cancelX6Plan(entry, partRows, rawRows) {
  const base = { route: "GO", headerRows: [], soRows: [], needSoHead: "NO", lineSlices: [], lineCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const gd = joinChunks(partRows, entry.partPrefix + "GD|");
  if (!gd) return Object.assign(base, stepEnd(entry, "X6_GD", "the delivery part of the prepared payload is missing", true));
  const { head, raw } = gx6Raw(rawRows);
  if (!head) return Object.assign(base, stepEnd(entry, "X6_GD", "the Goods Delivery cannot be read", true));
  if (s(head.gd_status) !== "Processing" && s(head.gd_status) !== "Cancelled") return Object.assign(base, stepEnd(entry, "X6_GD", "the Goods Delivery is " + s(head.gd_status) + ", not Processing", true));
  const hp = gd.header || {};
  const hrow = { id: entry.gdId };
  for (const c of ["gd_total", "picking_status", "delivery_no"]) hrow[c] = gx6Cell(c, c in hp ? hp[c] : head[c]);
  hrow.gd_status = "Cancelled";
  const soRow = "so_id" in hp || "so_no" in hp ? [{ id: entry.gdId, so_id: gx6Cell("so_id", "so_id" in hp ? hp.so_id : head.so_id), so_no: gx6Cell("so_no", "so_no" in hp ? hp.so_no : head.so_no) }] : [];
  const rows = [];
  const gone = [];
  for (const p of gd.lines || []) {
    const cur = raw[s(p.id)];
    if (!cur) {
      gone.push(s(p.id));
      continue;
    }
    const row = { id: s(p.id) };
    for (const c of GX6_LINE_COLS) row[c] = gx6Cell(c, c in p ? p[c] : cur[c]);
    rows.push(row);
  }
  if (gone.length) return Object.assign(base, stepEnd(entry, "X6_GD", gone.length + " delivery line(s) vanished (e.g. " + gone.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { headerRows: [hrow], soRows: soRow, needSoHead: soRow.length ? "YES" : "NO", lineSlices: slicesOf(rows, 250), lineCount: rows.length,
    result_message: rows.length + " line(s) + the header to write" });
};
const cancelX6Check = function cancelX6Check(entry, partRows, rawRows) {
  const gd = joinChunks(partRows, entry.partPrefix + "GD|") || {};
  const { head, raw } = gx6Raw(rawRows);
  const norm = (c, v) => (c === "so_id" || c === "assigned_to") && typeof v === "string" ? parseJ(v) : v;
  const off = [];
  if (!head || s(head.gd_status) !== "Cancelled") off.push("header gd_status");
  for (const [c, v] of Object.entries(gd.header || {})) if (head && !sameVal(norm(c, head[c]), v)) off.push("header." + c);
  for (const p of gd.lines || []) {
    const cur = raw[s(p.id)];
    for (const [c, v] of Object.entries(p)) if (c !== "id" && (!cur || !sameVal(norm(c, cur[c]), v))) {
      off.push(s(p.id) + "." + c);
      break;
    }
  }
  if (off.length) return stepEnd(entry, "X6_GD", off.length + " value(s) do not read back (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "X6_GD", (gd.lines || []).length + " line(s) + header", "delivery Cancelled");
};
