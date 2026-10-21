const entry = [{{node:code_node_RPentry.data}}][0];
const S = {
  organizationId: entry.organizationId,
  hdr: [{{node:sql_node_RPhdr.data}}][0], lines: [{{node:sql_node_RPlines.data}}][0], lock: [{{node:sql_node_RPlock.data}}][0], snap: [{{node:sql_node_RPsnap.data}}][0],
  soh: [{{node:sql_node_RPsoh.data}}][0], sol: [{{node:sql_node_RPsol.data}}][0], resv: [{{node:sql_node_RPresv.data}}][0], pick: [{{node:sql_node_RPpick.data}}][0],
  items: [{{node:sql_node_RPitems.data}}][0], cost: [{{node:sql_node_RPcost.data}}][0], pend: [{{node:sql_node_RPpend.data}}][0], prec: [{{node:sql_node_RPprec.data}}][0],
  phdr: [{{node:sql_node_RPphdr.data}}][0], hu: [{{node:sql_node_RPhu.data}}][0], hul: [{{node:sql_node_RPhul.data}}][0], dout: [{{node:sql_node_RPdout.data}}][0],
};
let res;
if (entry.route !== "GO") res = { route: "FAIL", code: entry.result_code, message: entry.result_message, operationKey: "", organizationId: entry.organizationId, movements: [], payload: "", partRows: [], lineCount: 0, movementCount: 0, gdId: entry.gdId, unlockOk: 0 };
else res = grPlan(entry, S);
console.log("prepare plan", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk }));
return res;
