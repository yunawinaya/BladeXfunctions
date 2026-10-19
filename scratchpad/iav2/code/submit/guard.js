// IA_V2_SUBMIT - Guard (CONTRACT section 7 read 1); a refused request reads and writes nothing (INVALID 400)
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const saveAs = s(inp.saveAs);
  const pageIn = s(inp.pageStatus);
  const page = pageIn === "Clone" || pageIn === "Copy" ? "Add" : pageIn;
  // the client sends every request key on every call ("" or "0" = no IA)
  const iaId = s(inp.iaId) === "0" ? "" : s(inp.iaId);
  const key = s(inp.key);
  const tenantId = s(inp.tenantId);
  const source = s(inp.source).toUpperCase() || "FORM";
  const form = inp.form;
  const org = obj(form) ? iaIdStr(form.organization_id) : "";
  const nonce = (s(inp.uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const base = { operation: op, saveAs: saveAs, pageStatus: page, pageStatusIn: pageIn, iaId: "0", key: "NOKEY", tenantId: "0", uid: s(inp.uid), source: source,
    nonce: nonce, clone: "NO", organizationId: "0" };
  const bad = (why) => answer("REJECT", "400", why, Object.assign(base, { errorCode: "IA_INVALID_REQUEST" }));
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(tenantId)) return bad("no session tenant");
  if (["FORM", "MOBILE"].indexOf(source) < 0) return bad("source must be FORM or MOBILE");
  const keyOk = IA_KEY_RE.test(key);
  if (op === "STATUS") {
    if (iaId && !digits(iaId)) return bad("ia_id: digits only");
    if (key && !keyOk) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
    if (!digits(iaId) && !keyOk) return bad("STATUS needs ia_id or idempotency_key");
    return answer("CONTINUE", "", "", Object.assign(base, { errorCode: "", iaId: digits(iaId) ? iaId : "0", key: keyOk ? key : "NOKEY", tenantId: tenantId,
      organizationId: org || "0" }));
  }
  if (["Draft", "Completed"].indexOf(saveAs) < 0) return bad("saveAs must be Draft or Completed");
  if (page === "View") return bad("an Item Assembly in View mode can't be saved");
  if (["Add", "Edit"].indexOf(page) < 0) return bad("pageStatus must be Add, Edit or Clone");
  if (page === "Edit" ? !digits(iaId) : iaId !== "") return bad(page === "Edit" ? "ia_id: digits only" : "ia_id must be empty for Add / Clone");
  if (!keyOk) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  if (!obj(form)) return bad("form: the Item Assembly's record");
  if (!digits(org)) return bad("form.organization_id: digits only");
  return answer("CONTINUE", "", "", Object.assign(base, { errorCode: "", iaId: page === "Edit" ? iaId : "0", key: key, tenantId: tenantId,
    clone: pageIn !== page ? "YES" : "NO", organizationId: org }));
};
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], saveAs: [{{workflowparams:saveAs}}][0], pageStatus: [{{workflowparams:pageStatus}}][0],
  iaId: [{{workflowparams:ia_id}}][0], key: [{{workflowparams:idempotency_key}}][0], source: [{{workflowparams:source}}][0],
  form: [{{workflowparams:form}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0], uuid: [{{system:uuid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, saveAs: res.saveAs, page: res.pageStatusIn, ia: res.iaId, message: res.message }));
return res;
