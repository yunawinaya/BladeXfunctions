const entry = [{{node:code_node_GCentry.data}}][0];
const S = {
  organizationId: entry.organizationId,
  hdr: [{{node:sql_node_GChdr.data}}][0], lines: [{{node:sql_node_GClines.data}}][0], setup: [{{node:sql_node_GCsetup.data}}][0],
  link: [{{node:sql_node_GClink.data}}][0], items: [{{node:sql_node_GCitems.data}}][0], sohl: [{{node:sql_node_GCsohl.data}}][0],
  soh: [{{node:sql_node_GCsoh.data}}][0], alloc: [{{node:sql_node_GCalloc.data}}][0], pend: [{{node:sql_node_GCpend.data}}][0],
  top: [{{node:sql_node_GCtop.data}}][0], topr: [{{node:sql_node_GCtopr.data}}][0], lock: [{{node:sql_node_GClock.data}}][0],
};
let res;
if (entry.route !== "GO") res = { route: "FAIL", code: entry.result_code, message: entry.result_message, operationKey: "", organizationId: entry.organizationId, movements: [], payload: "", partRows: [], lineCount: 0, movementCount: 0, gdId: entry.gdId, unlockOk: 0 };
else res = gcPlan(entry, S);
console.log("prepare plan", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk }));
return res;
