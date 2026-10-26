// GD_EDIT_COMMIT - E6 HEADER: the header's changed cells (part GDH) where they still hold what PREPARE read, the Picking's
// picking_status (update_node_QtTmd6b8, part STAMP) and gd_status Created - the GD's unlock. The update-node writes NULL for a
// mapped column a record leaves out, so the row goes out whole over the fresh header. Then our Picking lock is released,
// only at the version this job holds (E5's, or SUBMIT's when E5 wrote nothing).
const geHeaderCols = (K) => Object.keys(K.header).filter((c) => ["id", "create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted",
  "sub_tenant_id", "table_gd", "table_insufficient", "table_item_balance"].indexOf(c) < 0);
const geHeadCell = function geHeadCell(K, c, v) {
  if (v === undefined || v === null) return null;
  const kind = (K.header[c] || [])[0];
  if (kind === "dec") return v === "" ? null : q8(v).toFixed(8);
  if (kind === "int") return v === "" ? null : Math.round(Number(v));
  if (kind === "json" && typeof v === "string") { const p = parseJ(v); return p === null ? v : p; }
  return v;
};
// cfRows: the header table's custom-field definitions (cf.js), so a custom_fields cell compares as names
const commitE6Plan = function commitE6Plan(entry, gdh, stamp, headRows, pickRows, K, cfRows) {
  const defs = geCfDefs(cfRows);
  const same = geSame(defs);
  const base = { route: "GO", headerRows: [], needHeader: "NO", pickUnlockRows: [], needPickUnlock: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const head = list(headRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r))[0] || null;
  if (!head || !gdh) return Object.assign(base, stepEnd(entry, "E6_HEADER", "the Goods Delivery or the header part is missing", true));
  if (/"9\d{18}"|#GDE-DELIVERY-NO#/.test(JSON.stringify(gdh.cells || {}))) return Object.assign(base, stepEnd(entry, "E6_HEADER", "a header cell still holds a placeholder", true));
  const want = Object.assign({}, gdh.cells || {});
  if (stamp && stamp.gdPickingStatus !== null && stamp.gdPickingStatus !== undefined) want.picking_status = stamp.gdPickingStatus;
  const before = Object.assign({}, gdh.before || {});
  const conflicts = [];
  for (const c of Object.keys(gdh.cells || {})) if (!same(c, head[c], want[c]) && !same(c, head[c], before[c])) conflicts.push(c);
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "E6_HEADER", "header column(s) changed by someone else meanwhile: " + conflicts.slice(0, 5).join(", "), true));
  const pk = list(pickRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r)).filter((p) => p && s(p.id) === s(entry.pickingId))[0];
  if (pk && Number(pk.is_processing) === 1 && entry.pickVersion && s(pk.update_time) === s(entry.pickVersion)) base.pickUnlockRows = [{ id: s(pk.id), is_processing: 0 }], base.needPickUnlock = "YES";
  const atTarget = s(head.gd_status) === "Created" && Object.keys(want).every((c) => same(c, head[c], want[c]));
  if (atTarget) return Object.assign(base, { result_message: "the header is already saved" });
  if (s(head.gd_status) !== "Processing") return Object.assign(base, stepEnd(entry, "E6_HEADER", "the Goods Delivery is " + s(head.gd_status) + ", not Processing", true));
  const row = { id: entry.gdId };
  // custom_fields goes out by name: the platform drops a header custom_fields keyed by ids (dev GD/20261027/632) and stores names as ids
  const hasDefs = Object.keys(defs).length > 0;
  for (const c of geHeaderCols(K)) {
    const v = c in want ? want[c] : head[c];
    row[c] = geHeadCell(K, c, c === "custom_fields" && hasDefs ? geCfCanon(v, defs) : v);
  }
  row.gd_status = "Created";
  return Object.assign(base, { headerRows: [row], needHeader: "YES", result_message: Object.keys(want).length + " header cell(s) + gd_status Created" });
};
// wroteRows: the plan's headerRows - a non-empty custom_fields it wrote must read back (a dropped one would be a silent wipe)
const commitE6Check = function commitE6Check(entry, gdh, stamp, headRows, cfRows, wroteRows) {
  const defs = geCfDefs(cfRows);
  const same = geSame(defs);
  const head = list(headRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r))[0] || {};
  const want = Object.assign({}, (gdh || {}).cells || {});
  if (stamp && stamp.gdPickingStatus !== null && stamp.gdPickingStatus !== undefined) want.picking_status = stamp.gdPickingStatus;
  const off = Object.keys(want).filter((c) => !same(c, head[c], want[c]));
  const wrote = list(wroteRows)[0];
  const wcf = wrote ? geCfCanon(wrote.custom_fields, defs) : null;
  if (wcf && typeof wcf === "object" && !Array.isArray(wcf) && Object.keys(wcf).length && off.indexOf("custom_fields") < 0 &&
    !same("custom_fields", head.custom_fields, wrote.custom_fields)) off.push("custom_fields");
  if (s(head.gd_status) !== "Created") off.unshift("gd_status " + s(head.gd_status));
  if (off.length) return stepEnd(entry, "E6_HEADER", "the header does not read back (" + off.slice(0, 5).join(", ") + ")", false);
  return stepOk(entry, "E6_HEADER", s(head.delivery_no), "delivery " + s(head.delivery_no) + " saved as Created");
};
