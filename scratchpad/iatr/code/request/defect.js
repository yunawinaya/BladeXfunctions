// IA_TRANSFER_REQUEST - DEFECT: the engine's answer. 200 -> the reservation rows and the IA lines follow; anything else -> nothing more
// is written, our claim is freed and the answer says why: 409 another operation holds the stock, 400 the engine refused (e.g. the
// stock is no longer there), else 500 unconfirmed (the same click again replays the operation: it never moves twice)
const trDefectAns = function trDefectAns(g, win, ans) {
  const s = iatrS;
  const a = ans || {};
  const code = s(a.code);
  const free = { id: s(win.claimId) || "0", step_status: "FREE", finished_at: s(win.free && win.free.finished_at) || null,
    result_ref: ("DEFECT|" + (code || "NONE") + "|" + g.key).slice(0, 250) };
  if (code === "200") return { route: "OK", code: "200", message: "", free: free };
  const message = code === "409" ? "The stock is in use by another operation right now: report the defect again in a moment."
    : code === "400" ? "The defect could not be moved to Blocked: " + (s(a.message) || s(a.result_code) || "the stock refused the move") + "."
      : "The defect could not be confirmed: open the Item Assembly again to see it, then report it again if it is not there.";
  return { route: "STOP", code: code === "409" || code === "400" ? code : "500", message: message, free: free };
};
const res = trDefectAns([{{node:code_node_TRguard.data}}][0], [{{node:code_node_TRwin.data}}][0], [{{node:workflow_node_TRdefect.data}}][0]);
console.log("request defect", JSON.stringify({ route: res.route, code: res.code, message: res.message }));
return res;
