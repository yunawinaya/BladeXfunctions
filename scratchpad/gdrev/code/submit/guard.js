// GD_REVERT_SUBMIT - Guard: operation (SUBMIT | STATUS), gd_id, source (LIST | MOBILE), session tenant + user
const revertGuard = function revertGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const gdId = s(inp.gdId);
  const source = s(inp.source).toUpperCase() || "LIST";
  const tenantId = s(inp.tenantId);
  const bad = (why) => answer("REJECT", "400", why, { operation: op, gdId: "0", tenantId: "0", source: source, uid: "" });
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(gdId)) return bad("gd_id: digits only");
  if (["LIST", "MOBILE"].indexOf(source) < 0) return bad("source must be LIST or MOBILE");
  if (!digits(tenantId)) return bad("no session tenant");
  return answer("CONTINUE", "", "", { operation: op, gdId: gdId, tenantId: tenantId, source: source, uid: s(inp.uid) });
};
const res = revertGuard({ operation: [{{workflowparams:operation}}][0], gdId: [{{workflowparams:gd_id}}][0], source: [{{workflowparams:source}}][0],
  tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("revert guard", JSON.stringify({ route: res.route, op: res.operation, gd: res.gdId, source: res.source, message: res.message }));
return res;
