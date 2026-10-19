// GD_COMPLETE_SUBMIT - Guard: operation (SUBMIT | STATUS), gd_id, source (FORM | LIST | PICKING | PACKING), the answers the
// GD form's prompts gave (needCL, continueZero, isForceComplete, auto_si_confirmed / auto_si_skip), causation_id, session
// tenant + user. The form's own data (FORM) is read by the gate node only.
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const gdId = s(inp.gdId);
  const source = s(inp.source).toUpperCase() || "FORM";
  const tenantId = s(inp.tenantId);
  const bad = (why) => answer("REJECT", "400", why, { operation: op, gdId: "0", tenantId: "0", source: source, uid: "", causationId: "", force: "", answers: {} });
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(gdId)) return bad("gd_id: digits only");
  if (["FORM", "LIST", "PICKING", "PACKING"].indexOf(source) < 0) return bad("source must be FORM, LIST, PICKING or PACKING");
  if (!digits(tenantId)) return bad("no session tenant");
  let a = inp.answers;
  if (typeof a === "string") {
    try {
      a = JSON.parse(a);
    } catch (e) {
      a = null;
    }
  }
  a = a && typeof a === "object" ? a : {};
  // Force Complete is the user's answer to the 406 prompt: the form's or the list's only
  const force = s(a.isForceComplete) === "Yes" && (source === "FORM" || source === "LIST") ? "Yes" : "";
  return answer("CONTINUE", "", "", {
    operation: op, gdId: gdId, tenantId: tenantId, source: source, uid: s(inp.uid), causationId: s(inp.causationId).slice(0, 200), force: force,
    answers: { needCL: s(a.needCL) || "required", continueZero: s(a.continueZero), isForceComplete: force, auto_si_confirmed: s(a.auto_si_confirmed), auto_si_skip: s(a.auto_si_skip) },
  });
};
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], gdId: [{{workflowparams:gd_id}}][0], source: [{{workflowparams:source}}][0], answers: [{{workflowparams:answers}}][0],
  causationId: [{{workflowparams:causation_id}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, gd: res.gdId, source: res.source, message: res.message }));
return res;
