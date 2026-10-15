// GD_EDIT_COMMIT - E3 RESERVATIONS (gdc's C3): each planned update written only while the row still holds what PREPARE
// read (at its target = done; anything else -> review); each create once (job_line_key <job>|C|<n>). The placeholders
// PREPARE minted are resolved first: a new line's id (E2's inserts, by job_line_key) and a Draft's number (E0N).
const GE_E3_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const GE_RES_CREATE_COLS = ["doc_type", "status", "parent_id", "parent_line_id", "parent_no", "doc_no", "doc_id", "doc_line_id", "material_id", "item_code", "item_name", "item_desc",
  "batch_id", "bin_location", "item_uom", "reserved_qty", "delivered_qty", "open_qty", "reserved_date", "line_no", "plant_id", "organization_id", "remark", "target_gd_id",
  "source_reserved_id", "handling_unit_id", "job_line_key"];
const geResDec = { reserved_qty: 1, open_qty: 1, delivered_qty: 1 };
const geResCell = (c, v) => (v === undefined || v === null ? null : geResDec[c] ? (v === "" ? null : q8(v).toFixed(8)) : v);
const commitE3Plan = function commitE3Plan(entry, resPart, gdl, rows, lineRows) {
  const base = { route: "GO", slices: [], writeCount: 0, createRows: [], needCreates: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  if (!resPart) return Object.assign(base, stepEnd(entry, "E3_RESERVATIONS", "the reservation part of the prepared payload is missing", true));
  const rv = geResolver(entry, gdl || {}, list(lineRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r)), entry.number);
  const res = rv.fix(resPart);
  const left = rv.unresolved({ u: (res.updates || []).map((u) => u.after), c: res.creates || [] });
  if (left) return Object.assign(base, stepEnd(entry, "E3_RESERVATIONS", "a placeholder is still unresolved (" + left[0] + "): the lines or the number are missing", true));
  const now = {}, made = {};
  for (const r of list(rows)) {
    const o = typeof r.j === "string" ? parseJ(r.j) : r;
    if (!o) continue;
    if (s(r.k) === "C") made[s(o.job_line_key)] = (made[s(o.job_line_key)] || 0) + 1;
    else now[s(o.id)] = o;
  }
  const writes = [], conflicts = [];
  for (const u of res.updates || []) {
    const cur = now[s(u.id)];
    if (!cur || String(cur.is_deleted) !== "0") { conflicts.push(s(u.id) + " (gone)"); continue; }
    if (GE_E3_COLS.every((c) => sameVal(cur[c], u.after[c]))) continue;
    if (GE_E3_COLS.every((c) => sameVal(cur[c], u.before[c]))) { const w = { id: s(u.id) }; for (const c of GE_E3_COLS) w[c] = geResCell(c, u.after[c]); writes.push(w); }
    else conflicts.push(s(u.id));
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "E3_RESERVATIONS", conflicts.length + " reservation(s) changed by someone else after the stock moved (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  const dup = Object.keys(made).filter((k) => made[k] > 1);
  if (dup.length) return Object.assign(base, stepEnd(entry, "E3_RESERVATIONS", "reservation(s) created twice: " + dup.slice(0, 3).join(", "), true));
  const creates = (res.creates || []).filter((c) => !made[s(c.job_line_key)]).map((c) => {
    const o = {};
    for (const k of GE_RES_CREATE_COLS) o[k] = geResCell(k, c[k]);
    // add_node_ojy0rTgC: doc_id <- the record's target_gd_id
    o.doc_id = c.target_gd_id === undefined ? null : c.target_gd_id;
    return o;
  });
  return Object.assign(base, { slices: slicesOf(writes, 250), writeCount: writes.length, createRows: creates, needCreates: creates.length ? "YES" : "NO",
    result_message: writes.length + " reservation update(s), " + creates.length + " create(s) to write" });
};
const commitE3Check = function commitE3Check(entry, resPart, gdl, rows, lineRows) {
  const rv = geResolver(entry, gdl || {}, list(lineRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r)), entry.number);
  const res = rv.fix(resPart || {});
  const now = {}, made = {};
  for (const r of list(rows)) {
    const o = typeof r.j === "string" ? parseJ(r.j) : r;
    if (!o) continue;
    if (s(r.k) === "C") made[s(o.job_line_key)] = (made[s(o.job_line_key)] || 0) + 1;
    else now[s(o.id)] = o;
  }
  const off = (res.updates || []).filter((u) => !now[s(u.id)] || !GE_E3_COLS.every((c) => sameVal(now[s(u.id)][c], u.after[c])));
  const missing = (res.creates || []).filter((c) => !made[s(c.job_line_key)]);
  const twice = Object.keys(made).filter((k) => made[k] > 1);
  if (twice.length) return stepEnd(entry, "E3_RESERVATIONS", "reservation(s) created twice: " + twice.slice(0, 3).join(", "), true);
  if (off.length || missing.length) return stepEnd(entry, "E3_RESERVATIONS", off.length + " update(s) and " + missing.length + " create(s) do not read back", false);
  return stepOk(entry, "E3_RESERVATIONS", (res.updates || []).length + " updated, " + (res.creates || []).length + " created", "reservations saved");
};
