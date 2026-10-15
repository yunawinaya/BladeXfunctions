const entry = [{{node:code_node_PPentry.data}}][0];
const S = {
  hdr: [{{node:sql_node_PPhdr.data}}][0], lines: [{{node:sql_node_PPlines.data}}][0], records: [{{node:sql_node_PPrecords.data}}][0],
  gr: [{{node:sql_node_PPgr.data}}][0], items: [{{node:sql_node_PPitems.data}}][0], transit: [{{node:sql_node_PPtransit.data}}][0],
  others: [{{node:sql_node_PPothers.data}}][0], qi: [{{node:sql_node_PPqi.data}}][0], setup: [{{node:sql_node_PPsetup.data}}][0],
  bbal: [{{node:sql_node_PPbbal.data}}][0], lock: [{{node:sql_node_PPlock.data}}][0],
};
let res;
if (entry.route !== "GO") res = { route: "FAIL", code: entry.result_code, message: entry.result_message, payload: "", partRows: [], lineCount: 0, movementCount: 0, toId: entry.toId, unlockOk: 0 };
else res = pwPlan(entry, S);
console.log("prepare plan", JSON.stringify({ route: res.route, code: res.code, message: res.message, lines: res.lineCount, movements: res.movementCount, parts: res.partRows.length, unlock: res.unlockOk }));
return res;
