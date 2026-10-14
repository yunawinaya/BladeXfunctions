// GD_COMPLETE_COMMIT - C3 plan: each planned reservation update is written only while the row still holds what PREPARE
// read (a row already at its target is done; anything else is a conflict -> review); each create only once (job_line_key)
const RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const CREATE_COLS = ["doc_type", "status", "parent_id", "parent_line_id", "parent_no", "doc_no", "doc_id", "doc_line_id", "material_id", "item_code", "item_name", "item_desc",
  "batch_id", "bin_location", "item_uom", "reserved_qty", "delivered_qty", "open_qty", "reserved_date", "line_no", "plant_id", "organization_id", "remark", "target_gd_id",
  "source_reserved_id", "handling_unit_id", "job_line_key"];
const commitC3Plan = function commitC3Plan(entry, partRows, rows) {
  const res = joinChunks(partRows, entry.partPrefix + "RES|");
  const base = { route: "GO", slices: [], writeCount: 0, createRows: [], needCreates: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  if (!res) return Object.assign(base, stepEnd(entry, "C3_RESERVATIONS", "the reservation part of the prepared payload is missing", true));
  const now = {};
  const made = {};
  for (const r of list(rows)) {
    const o = parseJ(r.j);
    if (!o) continue;
    if (s(r.k) === "C") made[s(o.job_line_key)] = (made[s(o.job_line_key)] || 0) + 1;
    else now[s(o.id)] = o;
  }
  const writes = [];
  const conflicts = [];
  for (const u of res.updates || []) {
    const cur = now[s(u.id)];
    if (!cur || String(cur.is_deleted) !== "0") { conflicts.push(s(u.id) + " (gone)"); continue; }
    if (RES_COLS.every((c) => sameVal(cur[c], u.after[c]))) continue;
    if (RES_COLS.every((c) => sameVal(cur[c], u.before[c]))) writes.push(Object.assign({ id: s(u.id) }, u.after));
    else conflicts.push(s(u.id));
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "C3_RESERVATIONS", conflicts.length + " reservation(s) changed by someone else after the stock moved (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const dup = Object.keys(made).filter((k) => made[k] > 1);
  if (dup.length) return Object.assign(base, stepEnd(entry, "C3_RESERVATIONS", "reservation(s) created twice: " + dup.slice(0, 3).join(", "), true));
  const creates = (res.creates || []).filter((c) => !made[s(c.job_line_key)]).map((c) => {
    const o = {};
    for (const k of CREATE_COLS) o[k] = c[k] === undefined ? null : c[k];
    o.doc_id = c.target_gd_id === undefined ? null : c.target_gd_id;
    return o;
  });
  return Object.assign(base, { slices: slicesOf(writes, 250), writeCount: writes.length, createRows: creates, needCreates: creates.length ? "YES" : "NO",
    result_message: writes.length + " reservation update(s), " + creates.length + " create(s) to write" });
};
const res = commitC3Plan([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc3part.data}}][0], [{{node:sql_node_CCc3rows.data}}][0]);
console.log("commit C3 plan", JSON.stringify({ route: res.route, writes: res.writeCount, creates: res.createRows.length, result: res.result_code, message: res.result_message }));
return res;
