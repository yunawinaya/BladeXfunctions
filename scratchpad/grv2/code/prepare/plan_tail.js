const entry = [{{node:code_node_RPentry.data}}][0];
const S = {
  hdr: [{{node:sql_node_RPhdr.data}}][0], lines: [{{node:sql_node_RPlines.data}}][0], pol: [{{node:sql_node_RPpol.data}}][0],
  poh: [{{node:sql_node_RPpoh.data}}][0], oo: [{{node:sql_node_RPoo.data}}][0], items: [{{node:sql_node_RPitems.data}}][0],
  setup: [{{node:sql_node_RPsetup.data}}][0], bnc: [{{node:sql_node_RPbnc.data}}][0], batches: [{{node:sql_node_RPbatches.data}}][0],
  lock: [{{node:sql_node_RPlock.data}}][0],
};
let res;
if (!entry || entry.route !== "GO") {
  res = { route: "FAIL", code: (entry && entry.result_code) || "GRC_INVALID_DATA", message: (entry && entry.result_message) || "no entry", operationKey: "",
    organizationId: (entry && entry.organizationId) || "", grId: (entry && entry.grId) || "", grNo: "", previousStatus: "", payload: "", partRows: [],
    movements: [], lineCount: 0, movementCount: 0, unlockOk: 0 };
} else {
  res = grPlan(entry, S, { now: Date.now(), withMovements: false, allowWA: true });
}
console.log("prepare plan", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk }));
return res;
