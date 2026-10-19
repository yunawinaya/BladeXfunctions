const guard = [{{node:code_node_RSguard.data}}][0];
const S = { items: [{{node:sql_node_RSitems.data}}][0], pol: [{{node:sql_node_RSpol.data}}][0], poh: [{{node:sql_node_RSpoh.data}}][0], setup: [{{node:sql_node_RSsetup.data}}][0] };
const t0 = Date.now();
const res = submitGate(guard, [{{node:code_node_RSentry.data}}][0], [{{node:code_node_RSkeys.data}}][0], S, [{{workflowparams:form}}][0],
  [{{node:sql_node_RSbusy.data}}][0]);
console.log("submit gate", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: ((res.allData || {}).table_gr || []).length, ms: Date.now() - t0 }));
return res;
