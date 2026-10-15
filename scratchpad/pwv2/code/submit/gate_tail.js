const guard = [{{node:code_node_PSguard.data}}][0];
const S = { hdr: [{{node:sql_node_PShdr.data}}][0], lines: [{{node:sql_node_PSlines.data}}][0], items: [{{node:sql_node_PSitems.data}}][0], cost: [{{node:sql_node_PScost.data}}][0] };
const t0 = Date.now();
const res = submitGate(guard, [{{node:code_node_PSentry.data}}][0], S);
console.log("submit gate", JSON.stringify({ route: res.route, code: res.code, message: res.message, rows: res.rowCount, ms: Date.now() - t0 }));
return res;
