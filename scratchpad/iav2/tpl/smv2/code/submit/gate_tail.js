const t0 = Date.now();
const res = submitGate([{{node:code_node_LSguard.data}}][0], [{{node:code_node_LSentry.data}}][0], [{{node:code_node_LSkeys.data}}][0], [{{workflowparams:form}}][0],
  { items: [{{node:sql_node_LSitems.data}}][0], cost: [{{node:sql_node_LScost.data}}][0], stored: [{{node:sql_node_LSstored.data}}][0] });
console.log("submit gate", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, rows: res.rowCount, moves: res.movementCount,
  parts: res.partNames.length, ms: Date.now() - t0 }));
return res;
