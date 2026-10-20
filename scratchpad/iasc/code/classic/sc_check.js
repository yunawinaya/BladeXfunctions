// IA_SAVE v13 - Small Cycle check (scClassicCheck, code/shared/sc_check.js): STOP = 400 before any write
const all = [{{node:code_fillback.data.allData}}][0] || {};
const rows = [{{node:sql_node_SCsource.data}}][0];
// a line sent back with its id but without sc_ref_key (a mobile save) gets its stored key back (non-empty ones only), so the line
// stays tied to the snapshot and the checks below see it
const kept = {};
((spRows(rows)[0] || {}).keys || []).forEach((x) => {
  if (x && x.k) kept[String(x.id)] = String(x.k);
});
const sent = Array.isArray(all.stock_movement);
const lines = (sent ? all.stock_movement : []).map((l) => (l && typeof l === "object" && !Object.prototype.hasOwnProperty.call(l, "sc_ref_key") &&
  kept[String(l.id)] ? Object.assign({}, l, { sc_ref_key: kept[String(l.id)] }) : l));
const res = scClassicCheck({ allData: sent ? Object.assign({}, all, { stock_movement: lines }) : all, saveAs: [{{workflowparams:saveAs}}][0],
  scIn: [{{node:code_node_SCin.data}}][0], rows: rows, uid: [{{system:uid}}][0], nowIso: new Date().toISOString() });
console.log("small cycle check", JSON.stringify({ route: res.route, message: res.message, link: res.source_so_line_id, mode: res.bom_consumption_mode }));
return { route: res.route, message: res.message, source_so_id: res.source_so_id, source_so_line_id: res.source_so_line_id,
  source_so_context_json: res.source_so_context_json, bom_consumption_mode: res.bom_consumption_mode, source_bom_id: res.source_bom_id,
  bom_snapshot_json: res.bom_snapshot_json, planned_output_qty: res.planned_output_qty, scLines: { stock_movement: sent ? lines : all.stock_movement } };
