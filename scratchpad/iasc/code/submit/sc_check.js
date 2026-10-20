// IA_V2_SUBMIT v4 - Small Cycle check (scClassicCheck, code/shared/sc_check.js): after the gate, BEFORE GENERATE_BATCH; STOP = 400 IA_SC_INVALID
const res = scClassicCheck({ allData: [{{node:code_node_ISgate.data.allData}}][0], saveAs: "Completed", scIn: [{{node:code_node_ISscIn.data}}][0],
  rows: [{{node:sql_node_ISsc.data}}][0], uid: [{{node:code_node_ISguard.data.uid}}][0], nowIso: new Date().toISOString() });
console.log("small cycle check", JSON.stringify({ route: res.route, message: res.message, link: res.source_so_line_id, mode: res.bom_consumption_mode }));
return { route: res.route, message: res.message, source_so_id: res.source_so_id, source_so_line_id: res.source_so_line_id,
  source_so_context_json: res.source_so_context_json, bom_consumption_mode: res.bom_consumption_mode, source_bom_id: res.source_bom_id,
  bom_snapshot_json: res.bom_snapshot_json, planned_output_qty: res.planned_output_qty };
