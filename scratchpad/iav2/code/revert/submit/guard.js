// IA_REVERT_V2_SUBMIT - Guard: the request (operation, ia_id, key, source, min_picks, the list row) and the session
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const iaId = s(inp.iaId);
  const key = s(inp.key);
  const tenantId = s(inp.tenantId);
  const minRaw = s(inp.minPicks);
  const form = inp.form && typeof inp.form === "object" && !Array.isArray(inp.form) ? inp.form : null;
  const nonce = (s(inp.uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const bad = (why) => answer("REJECT", "400", why, { operation: op, iaId: "0", key: "", tenantId: "0", uid: "", source: "", minPicks: 0, formStatus: "", formOrg: "0", nonce: nonce,
    errorCode: "IA_RV_INVALID_REQUEST" });
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(iaId) || iaId === "0") return bad("ia_id: digits only");
  if (op === "SUBMIT" && !IA_KEY_RE.test(key)) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  if (op === "STATUS" && key && !IA_KEY_RE.test(key)) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  if (minRaw && !/^[0-9]{1,9}$/.test(minRaw)) return bad("min_picks: digits only");
  if (!digits(tenantId)) return bad("no session tenant");
  if (op === "SUBMIT" && !form) return bad("form: the list row is required");
  const formOrg = form ? s(form.organization_id) : "";
  if (op === "SUBMIT" && !digits(formOrg)) return bad("form.organization_id: digits only");
  return answer("CONTINUE", "", "", { operation: op, iaId: iaId, key: key, tenantId: tenantId, uid: s(inp.uid), source: s(inp.source).replace(/[^A-Za-z_]/g, "").slice(0, 20) || "LIST",
    minPicks: minRaw ? Number(minRaw) : 0, formStatus: form ? s(form.item_assembly_status) : "", formOrg: digits(formOrg) ? formOrg : "0", nonce: nonce, errorCode: "" });
};
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], iaId: [{{workflowparams:ia_id}}][0], key: [{{workflowparams:idempotency_key}}][0],
  source: [{{workflowparams:source}}][0], minPicks: [{{workflowparams:min_picks}}][0], form: [{{workflowparams:form}}][0], tenantId: [{{system:tenantId}}][0],
  uid: [{{system:uid}}][0], uuid: [{{system:uuid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, ia: res.iaId, message: res.message }));
return res;
