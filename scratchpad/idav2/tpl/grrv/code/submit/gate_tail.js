const rvGateT0 = Date.now();
const rvGateRes = rvGate([{{node:code_node_VSentry.data}}][0], { hdr: [{{node:sql_node_VShdr.data}}][0], lines: [{{node:sql_node_VSlines.data}}][0], movs: [{{node:sql_node_VSmovs.data}}][0] });
console.log("submit gate", JSON.stringify({ route: rvGateRes.route, code: rvGateRes.code, message: rvGateRes.message, lines: rvGateRes.lineCount, ms: Date.now() - rvGateT0 }));
return rvGateRes;
