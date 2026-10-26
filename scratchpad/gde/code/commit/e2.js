// GD_EDIT_COMMIT - E2 LINES: the GD's lines as the edit leaves them (part GDL), written where they still hold what PREPARE
// read. An update-node writes NULL for a mapped column a record leaves out, so a patched line goes out WHOLE: its fresh
// row with the patch's cells over it (decimals as q8 strings: the multipleOf trap). New lines are inserted under
// job_line_key <job>|L|<n> (a re-run skips the ones it finds); the children of a new bundle row wait for their parent's
// id (pass 2). Removed lines: is_deleted = 1. Anything not at its before / after -> review.
const GE_LINE_SKIP = ["id", "create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id", "goods_delivery_id", "parent_id", "children"];
const geLineCols = (K) => Object.keys(K.line).filter((c) => GE_LINE_SKIP.indexOf(c) < 0);
const geCell = function geCell(K, c, v) {
  if (v === undefined || v === null) return null;
  const kind = (K.line[c] || [])[0];
  if (kind === "dec") return v === "" ? null : q8(v).toFixed(8);
  if (kind === "int") return v === "" ? null : Math.round(Number(v));
  if (kind === "json" && typeof v === "string") { const p = parseJ(v); return p === null ? v : p; }
  return v;
};
const geLineRows = (rows) => { const o = {}; for (const r of list(rows)) { const x = typeof r.j === "string" ? parseJ(r.j) : r; if (x && x.id !== undefined) o[s(x.id)] = x; } return o; };
// custom fields compare as names (cf.js: geCfDefs / geCfCanon / geSame; E2's line reads carry the definitions row)
// what a check reads of the lines (E0 before anything, E2 after): id, is_deleted, job_line_key and every column a patch writes,
// each as jobj renders it (exprs: the build-time map, so no text from the payload reaches the SQL); not whole rows
const geLineCheckSql = function geLineCheckSql(gdl, exprs) {
  const cols = ["id", "is_deleted", "job_line_key"];
  for (const p of (gdl || {}).patches || []) for (const c of Object.keys(p.cells || {})) if (cols.indexOf(c) < 0) cols.push(c);
  return "JSON_OBJECT(" + cols.filter((c) => Object.prototype.hasOwnProperty.call(exprs, c)).map((c) => "'" + c + "', " + exprs[c]).join(", ") + ")";
};
const commitE2Plan = function commitE2Plan(entry, gdl, lineRows, K) {
  const base = { route: "GO", insertRows: [], needInsert: "NO", patchSlices: [], patchCount: 0, deleteRows: [], needDelete: "NO", deferred: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  if (!gdl) return Object.assign(base, stepEnd(entry, "E2_LINES", "the line part of the prepared payload is missing", true));
  const fresh = geLineRows(lineRows);
  const byKey = {};
  for (const r of Object.values(fresh)) if (s(r.job_line_key).indexOf(entry.jobId + "|L|") === 0 && String(r.is_deleted) === "0") byKey[s(r.job_line_key)] = (byKey[s(r.job_line_key)] || []).concat([s(r.id)]);
  const twice = Object.keys(byKey).filter((k) => byKey[k].length > 1);
  if (twice.length) return Object.assign(base, stepEnd(entry, "E2_LINES", "line(s) inserted twice: " + twice.slice(0, 3).join(", "), true));
  const idOf = {};
  (gdl.inserts || []).forEach((ins, i) => { const k = entry.jobId + "|L|" + (i + 1); if (byKey[k]) idOf[s(ins.ph)] = byKey[k][0]; });
  const cols = geLineCols(K);
  const conflicts = [];
  // inserts not made yet; a child of a new row waits until its parent exists
  const inserts = [];
  let deferred = 0;
  (gdl.inserts || []).forEach((ins, i) => {
    const k = entry.jobId + "|L|" + (i + 1);
    if (byKey[k]) return;
    let parent = null;
    if (ins.parent) {
      parent = /^9\d{18}$/.test(s(ins.parent)) ? idOf[s(ins.parent)] || null : s(ins.parent);
      if (!parent) { deferred++; return; }
    }
    const row = { goods_delivery_id: entry.gdId, parent_id: parent, job_line_key: k };
    for (const c of cols) if (c !== "job_line_key") row[c] = geCell(K, c, ins.row[c]);
    inserts.push(row);
  });
  // patches: written whole where every patched cell still holds its before
  const writes = [];
  const same = geSame(geCfDefs(lineRows));
  for (const p of gdl.patches || []) {
    const cur = fresh[s(p.id)];
    if (!cur || String(cur.is_deleted) !== "0") { conflicts.push(s(p.id) + " (gone)"); continue; }
    const cs = Object.keys(p.cells);
    if (cs.every((c) => same(c, cur[c], p.cells[c]))) continue;
    if (!cs.every((c) => same(c, cur[c], p.before[c]))) { conflicts.push(s(p.id)); continue; }
    const row = { id: s(p.id) };
    for (const c of cols) row[c] = geCell(K, c, c in p.cells ? p.cells[c] : cur[c]);
    writes.push(row);
  }
  const deletes = [];
  for (const id of gdl.deletes || []) {
    const cur = fresh[s(id)];
    if (cur && String(cur.is_deleted) === "0") deletes.push({ id: s(id), is_deleted: 1 });
  }
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "E2_LINES", conflicts.length + " line(s) changed by someone else after the stock moved (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { insertRows: inserts, needInsert: inserts.length ? "YES" : "NO", patchSlices: slicesOf(writes, 250), patchCount: writes.length,
    deleteRows: deletes, needDelete: deletes.length ? "YES" : "NO", deferred: deferred,
    result_message: inserts.length + " insert(s)" + (deferred ? " (+" + deferred + " waiting for their parent)" : "") + ", " + writes.length + " patch(es), " + deletes.length + " removal(s)" });
};
const commitE2Check = function commitE2Check(entry, gdl, lineRows) {
  const fresh = geLineRows(lineRows);
  const byKey = {};
  for (const r of Object.values(fresh)) if (s(r.job_line_key).indexOf(entry.jobId + "|L|") === 0 && String(r.is_deleted) === "0") byKey[s(r.job_line_key)] = (byKey[s(r.job_line_key)] || 0) + 1;
  const missing = (gdl.inserts || []).filter((x, i) => !byKey[entry.jobId + "|L|" + (i + 1)]).length;
  const twice = Object.keys(byKey).filter((k) => byKey[k] > 1);
  if (twice.length) return stepEnd(entry, "E2_LINES", "line(s) inserted twice: " + twice.slice(0, 3).join(", "), true);
  const same = geSame(geCfDefs(lineRows));
  const off = (gdl.patches || []).filter((p) => { const cur = fresh[s(p.id)]; return !cur || Object.keys(p.cells).some((c) => !same(c, cur[c], p.cells[c])); }).map((p) => s(p.id));
  const notGone = (gdl.deletes || []).filter((id) => fresh[s(id)] && String(fresh[s(id)].is_deleted) === "0");
  if (missing || off.length || notGone.length) return stepEnd(entry, "E2_LINES", missing + " insert(s), " + off.length + " patch(es) and " + notGone.length + " removal(s) do not read back", false);
  return stepOk(entry, "E2_LINES", (gdl.inserts || []).length + " inserted, " + (gdl.patches || []).length + " patched, " + (gdl.deletes || []).length + " removed", "lines saved");
};
