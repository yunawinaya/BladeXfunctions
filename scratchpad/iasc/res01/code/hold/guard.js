// IA_HOLD - Guard: digit ids, the operation and its caller, the session tenant and user
const hdGuard = function hdGuard(input) {
  const inp = input || {};
  const digits = (v) => /^[0-9]{1,20}$/.test(hdS(v));
  const bad = (why) => ({ route: "REJECT", code: "400", tenantId: "0", uid: "0", ia: "0", org: "0", op: "", source: "", result_message: why, result_json: "" });
  if (!digits(inp.tenantId)) return bad("no session tenant");
  if (!digits(inp.uid)) return bad("no session user");
  const wrong = ["ia_id", "organization_id"].filter((k) => !digits(inp[k]))[0];
  if (wrong) return bad(wrong + ": digits only");
  const op = hdS(inp.operation);
  if (op !== "RECONCILE" && op !== "RELEASE_ALL" && op !== "CLOSE" && op !== "CANCEL" && op !== "SWEEP" && op !== "CHECK") {
    return bad("operation: RECONCILE, RELEASE_ALL, CLOSE, CANCEL, SWEEP or CHECK");
  }
  const source = hdS(inp.source);
  if (["SAVE", "FORM", "LIST", "REVERT", "COMPLETE"].indexOf(source) < 0) return bad("source: SAVE, FORM, LIST, REVERT or COMPLETE");
  // MIN-05 (BA 10-22): SWEEP (read-only: the IAs deleted while still holding) is the list's alone
  if (op === "SWEEP" && source !== "LIST") return bad("SWEEP only from the list");
  // BA rev 1.2 C2: CHECK (read-only: how a completed IA's completion ended) is the form's and the list's
  if (op === "CHECK" && source !== "FORM" && source !== "LIST") return bad("CHECK only from the form or the list");
  return { route: op === "SWEEP" || op === "CHECK" ? op : "GO", code: "200", tenantId: hdS(inp.tenantId), uid: hdS(inp.uid), ia: hdS(inp.ia_id), org: hdS(inp.organization_id), op: op, source: source,
    result_message: "", result_json: "" };
};
const res = hdGuard({ ia_id: [{{workflowparams:ia_id}}][0], organization_id: [{{workflowparams:organization_id}}][0], operation: [{{workflowparams:operation}}][0],
  source: [{{workflowparams:source}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("hold guard", JSON.stringify({ route: res.route, op: res.op, source: res.source, message: res.result_message }));
return res;
