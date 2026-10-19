// LOT_V2_COMMIT - L3 LEDGER: the IT part on the transfer's In Transit rows read now (doc_id = the transfer, its organization).
// Updates by id, each with exactly the columns its classic node writes (source RECON = update_node_LOTreconAdjust, MAIN =
// update_node_LOTmainClose, CANCEL = update_node_LOTcancelClose, FOLD = an adjust then a close): at after -> done, at before ->
// write (Putaway V2's columns: _common.js ledgerAtAfter / ledgerAtBefore), else REQUIRES_REVIEW. Creates (add_node_LOTmainCreate / LOTreconCreate columns + job_line_key) once per job_line_key.
const LEDGER_SETS = { RECON: ["transit_qty", "open_qty", "status"], MAIN: ["received_qty", "open_qty", "status", "received_date"], CANCEL: ["open_qty", "status"],
  FOLD: ["transit_qty", "received_qty", "open_qty", "status", "received_date"] };
const LEDGER_ADD_COLS = __ADDCOLS__;
const keyCount = function keyCount(rows) {
  const out = {};
  for (const o of lotRows(rows)) if (s(o.job_line_key)) out[s(o.job_line_key)] = (out[s(o.job_line_key)] || 0) + 1;
  return out;
};
const commitL3Plan = function commitL3Plan(entry, itPartRows, ledgerRows) {
  const base = { route: "GO", reconSlices: [], mainSlices: [], cancelSlices: [], foldSlices: [], addSlices: [], updCount: 0, addCount: 0, expect: {}, jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_LOT" };
  const it = lotJoinChunks(itPartRows, entry.partPrefix + "IT|");
  if (!it || typeof it !== "object" || !Array.isArray(it.updates) || !Array.isArray(it.creates)) return Object.assign(base, stepEnd(entry, "L3_LEDGER", "the IT part of the prepared payload is missing or unreadable", true));
  const cur = byId(ledgerRows);
  const groups = { RECON: [], MAIN: [], CANCEL: [], FOLD: [] };
  const bad = [];
  const conflicts = [];
  const expectUpd = [];
  for (const u of it.updates) {
    const cols = LEDGER_SETS[s(u && u.source)];
    const after = u && u.after && typeof u.after === "object" ? u.after : {};
    const before = u && u.before && typeof u.before === "object" ? u.before : {};
    if (!cols || !digits(u.id) || !cols.every((k) => k in after)) { bad.push(s(u && u.id) + "/" + s(u && u.source)); continue; }
    const want = {};
    for (const k of cols) want[k] = after[k] === undefined ? null : after[k];
    expectUpd.push({ id: s(u.id), source: s(u.source), after: want });
    const c = cur[s(u.id)];
    if (!c) { conflicts.push(s(u.id) + " (gone)"); continue; }
    if (ledgerAtAfter(want, c)) continue;
    if (ledgerAtBefore(before, c)) groups[s(u.source)].push(Object.assign({ id: s(u.id) }, want));
    else conflicts.push(s(u.id));
  }
  if (bad.length) return Object.assign(base, stepEnd(entry, "L3_LEDGER", bad.length + " In Transit update(s) of an unknown shape (e.g. " + bad.slice(0, 3).join(", ") + ")", true));
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "L3_LEDGER", conflicts.length + " In Transit row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  // a create is found again by its job_line_key among the transfer's rows: it must be one of them (this job, this document)
  const keys = it.creates.map((c) => s(c && c.job_line_key));
  const seen = {};
  const off = [];
  it.creates.forEach((c, i) => {
    if (!c || keys[i].indexOf(entry.jobId + "|") !== 0 || seen[keys[i]] || s(c.doc_id) !== entry.lotId || s(c.organization_id) !== entry.organizationId) off.push(keys[i]);
    seen[keys[i]] = true;
  });
  if (off.length) return Object.assign(base, stepEnd(entry, "L3_LEDGER", off.length + " In Transit create(s) without a unique job_line_key of this job / document", true));
  const have = keyCount(ledgerRows);
  const doubled = keys.filter((k) => (have[k] || 0) > 1);
  if (doubled.length) return Object.assign(base, stepEnd(entry, "L3_LEDGER", doubled.length + " In Transit create(s) exist more than once (e.g. " + doubled.slice(0, 3).join(", ") + ")", true));
  const add = it.creates.filter((c, i) => !have[keys[i]]).map((c) => { const o = {}; for (const k of LEDGER_ADD_COLS) o[k] = c[k] === undefined ? null : c[k]; return o; });
  const updCount = groups.RECON.length + groups.MAIN.length + groups.CANCEL.length + groups.FOLD.length;
  return Object.assign(base, { reconSlices: slicesOf(groups.RECON, 250), mainSlices: slicesOf(groups.MAIN, 250), cancelSlices: slicesOf(groups.CANCEL, 250), foldSlices: slicesOf(groups.FOLD, 250),
    addSlices: slicesOf(add, 250), updCount: updCount, addCount: add.length, expect: { updates: expectUpd, keys: keys },
    result_message: updCount + " of " + it.updates.length + " In Transit update(s) and " + add.length + " of " + it.creates.length + " create(s) to write" });
};
const commitL3Check = function commitL3Check(entry, plan, ledgerRows) {
  const ex = plan.expect || {};
  const cur = byId(ledgerRows);
  const off = (ex.updates || []).filter((u) => !ledgerAtAfter(u.after, cur[s(u.id)])).map((u) => s(u.id));
  if (off.length) return stepEnd(entry, "L3_LEDGER", off.length + " In Transit row(s) not at the planned values after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  const have = keyCount(ledgerRows);
  const missing = (ex.keys || []).filter((k) => have[k] !== 1);
  if (missing.length) return stepEnd(entry, "L3_LEDGER", missing.length + " In Transit create(s) missing or doubled after the write (e.g. " + missing.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "L3_LEDGER", (ex.updates || []).length + " updated, " + (ex.keys || []).length + " created", "In Transit ledger saved");
};
const res = __CALL__;
console.log("commit L3", JSON.stringify({ route: res.route, upd: res.updCount, add: res.addCount, result: res.result_code, message: res.result_message }));
return res;
