// GR_COMPLETE_SUBMIT - Guard: operation (SUBMIT | STATUS), page_status (Add | Edit) with gr_id (Edit: digits; Add: empty),
// the client's idempotency key (one per click: page token + payload hash + generation), the answers the GR form's prompts
// gave (continueZero), session tenant + user. The form's data (allData) is read by the gate node only.
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const page = s(inp.pageStatus) || (s(inp.grId) ? "Edit" : "Add");
  const grId = s(inp.grId);
  const key = s(inp.key);
  const tenantId = s(inp.tenantId);
  const bad = (why) => answer("REJECT", "400", why, { operation: op, pageStatus: page, grId: "0", key: "", tenantId: "0", uid: "", answers: {} });
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (["Add", "Edit"].indexOf(page) < 0) return bad("page_status must be Add or Edit");
  if (page === "Edit" ? !digits(grId) : grId !== "") return bad(page === "Edit" ? "gr_id: digits only" : "gr_id must be empty for Add");
  if (!/^[A-Za-z0-9|:_.-]{8,128}$/.test(key)) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
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
  return answer("CONTINUE", "", "", { operation: op, pageStatus: page, grId: grId || "0", key: key, tenantId: tenantId, uid: s(inp.uid), answers: { continueZero: s(a.continueZero) } });
};
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], pageStatus: [{{workflowparams:page_status}}][0], grId: [{{workflowparams:gr_id}}][0],
  key: [{{workflowparams:idempotency_key}}][0], answers: [{{workflowparams:answers}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, page: res.pageStatus, gr: res.grId, message: res.message }));
return res;
