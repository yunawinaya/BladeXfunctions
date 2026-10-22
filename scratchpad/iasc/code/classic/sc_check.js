// IA_SAVE v13 - Small Cycle check (scClassicCheck, code/shared/sc_check.js): STOP = 400 before any write
const all = [{{node:code_fillback.data.allData}}][0] || {};
const rows = [{{node:sql_node_SCsource.data}}][0];
// a line sent back with its id but without sc_ref_key (a mobile save) gets its stored key back (non-empty ones only), so the line
// stays tied to the snapshot and the checks below see it
const kept = {};
const storedReq = {};
const storedRef = {};
const storedManual = {};
((spRows(rows)[0] || {}).keys || []).forEach((x) => {
  if (x && x.k) kept[String(x.id)] = String(x.k);
  if (x && x.r !== null && x.r !== undefined && String(x.r) !== "") storedReq[String(x.id)] = String(x.r);
  if (x && x.q !== null && x.q !== undefined && String(x.q) !== "") storedRef[String(x.id)] = String(x.q);
  if (x && x.m !== null && x.m !== undefined && String(x.m) !== "") storedManual[String(x.id)] = String(x.m);
});
const sent = Array.isArray(all.stock_movement);
const holdsOn = ([{{node:code_node_SCin.data}}][0] || {}).res === "YES";
const has = (l, k) => Object.prototype.hasOwnProperty.call(l, k);
// RES-01 required_qty (holds on): a line sent without it keeps its stored value (mobile); one that was following the BOM reference
// (stored required = stored reference) and comes back unchanged follows the new reference (a re-scale, mobile); empty -> the
// reference, else the quantity
// RF-09 (BA 10-22): a Required typed by hand (the form's required_manual "1") is the user's: it never follows the reference, even when it
// equals the old one; a line sent without the flag (mobile) keeps the stored one
const manualOf = (l) => (has(l, "required_manual") ? String(l.required_manual === null || l.required_manual === undefined ? "" : l.required_manual)
  : storedManual[String(l.id)] || "") === "1";
const numOf = (v) => (v === null || v === undefined || String(v) === "" || !isFinite(parseFloat(v)) ? null : parseFloat(v));
const reqOf = (l) => {
  const sr = numOf(storedReq[String(l.id)]);
  const sq = numOf(storedRef[String(l.id)]);
  let v = numOf(has(l, "required_qty") ? l.required_qty : storedReq[String(l.id)]);
  if (!manualOf(l) && v !== null && sr !== null && Math.abs(v - sr) < 1e-9 && sq !== null && sq > 0 && Math.abs(sr - sq) < 1e-9 && numOf(l.requested_qty) > 0) v = numOf(l.requested_qty);
  const x = v !== null ? v : numOf(l.requested_qty) > 0 ? numOf(l.requested_qty) : numOf(l.total_quantity);
  return x === null ? null : x.toFixed(8);
};
const lines = (sent ? all.stock_movement : []).map((l) => {
  if (!l || typeof l !== "object") return l;
  let out = !has(l, "sc_ref_key") && kept[String(l.id)] ? Object.assign({}, l, { sc_ref_key: kept[String(l.id)] }) : l;
  // RES-01's Reserved / Short columns are the screen's figures: never written
  if (has(out, "res_reserved") || has(out, "res_short")) {
    out = Object.assign({}, out);
    delete out.res_reserved;
    delete out.res_short;
  }
  return holdsOn ? Object.assign({}, out, { required_qty: reqOf(l), required_manual: manualOf(l) ? "1" : "" }) : out;
});
const res = scClassicCheck({ allData: sent ? Object.assign({}, all, { stock_movement: lines }) : all, saveAs: [{{workflowparams:saveAs}}][0],
  scIn: [{{node:code_node_SCin.data}}][0], rows: rows, uid: [{{system:uid}}][0], nowIso: new Date().toISOString() });
console.log("small cycle check", JSON.stringify({ route: res.route, message: res.message, link: res.source_so_line_id, mode: res.bom_consumption_mode }));
return { route: res.route, message: res.message, source_so_id: res.source_so_id, source_so_line_id: res.source_so_line_id,
  source_so_context_json: res.source_so_context_json, bom_consumption_mode: res.bom_consumption_mode, source_bom_id: res.source_bom_id,
  bom_snapshot_json: res.bom_snapshot_json, planned_output_qty: res.planned_output_qty, scLines: { stock_movement: sent ? lines : all.stock_movement } };
