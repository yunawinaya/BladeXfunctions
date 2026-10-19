// GR_REVERT_SUBMIT - Guard: operation (SUBMIT | STATUS), gr_id (digits), the client's idempotency key (one per click and
// receipt), where it came from, session tenant + user
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const grId = s(inp.grId);
  const key = s(inp.key);
  const tenantId = s(inp.tenantId);
  const bad = (why) => answer("REJECT", "400", why, { operation: op, grId: "0", key: "", tenantId: "0", uid: "", source: "" });
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(grId)) return bad("gr_id: digits only");
  if (!/^[A-Za-z0-9|:_.-]{8,128}$/.test(key)) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  if (!digits(tenantId)) return bad("no session tenant");
  return answer("CONTINUE", "", "", { operation: op, grId: grId, key: key, tenantId: tenantId, uid: s(inp.uid), source: s(inp.source).replace(/[^A-Za-z_]/g, "").slice(0, 20) || "LIST" });
};
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], grId: [{{workflowparams:gr_id}}][0], key: [{{workflowparams:idempotency_key}}][0],
  source: [{{workflowparams:source}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, gr: res.grId, message: res.message }));
return res;
