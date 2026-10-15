// PUTAWAY_ASYNC_SUBMIT - Guard: operation (SUBMIT | STATUS), to_id (digits), the client's idempotency key (one per click and
// content), who confirms (the session nickname: {{global:nickname}} is null inside a workflow), the confirmation request
// ({ source, lines: [{ id | parent_id, qty, target_location, target_inv_category, remark, storage_location }] }), session
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const toId = s(inp.toId);
  const key = s(inp.key);
  const tenantId = s(inp.tenantId);
  const bad = (why) => answer("REJECT", "400", why, { operation: op, toId: "0", key: "", tenantId: "0", uid: "", confirmedBy: "", request: {} });
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(toId)) return bad("to_id: digits only");
  if (!/^[A-Za-z0-9|:_.-]{8,128}$/.test(key)) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  if (!digits(tenantId)) return bad("no session tenant");
  let req = inp.request;
  if (typeof req === "string") {
    try {
      req = JSON.parse(req);
    } catch (e) {
      req = null;
    }
  }
  req = req && typeof req === "object" ? req : {};
  if (op === "SUBMIT" && !Array.isArray(req.lines)) return bad("request.lines: the rows to put away");
  return answer("CONTINUE", "", "", { operation: op, toId: toId, key: key, tenantId: tenantId, uid: s(inp.uid), confirmedBy: s(inp.confirmedBy).slice(0, 200),
    request: { source: s(req.source) || "FORM", lines: Array.isArray(req.lines) ? req.lines : [] } });
};
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], toId: [{{workflowparams:to_id}}][0], key: [{{workflowparams:idempotency_key}}][0],
  confirmedBy: [{{workflowparams:confirmed_by}}][0], request: [{{workflowparams:request}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, to: res.toId, rows: (res.request.lines || []).length, message: res.message }));
return res;
