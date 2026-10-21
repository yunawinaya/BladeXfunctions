// IDA_V2_SUBMIT - Guard (CONTRACT section 7 read 1); a refused request reads and writes nothing (INVALID 400)
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const saveAs = s(inp.saveAs);
  const pageIn = s(inp.pageStatus);
  const page = pageIn === "Clone" || pageIn === "Copy" ? "Add" : pageIn;
  // the client sends every request key on every call ("" or "0" = no IDA)
  const idaId = s(inp.idaId) === "0" ? "" : s(inp.idaId);
  const key = s(inp.key);
  const tenantId = s(inp.tenantId);
  const source = s(inp.source).toUpperCase() || "FORM";
  const org = idaIdStr(inp.organizationId);
  const nonce = (s(inp.uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const base = { operation: op, saveAs: saveAs, pageStatus: page, pageStatusIn: pageIn, idaId: "0", key: "NOKEY", tenantId: "0", uid: s(inp.uid), source: source,
    nonce: nonce, clone: "NO", organizationId: "0" };
  const bad = (why) => answer("REJECT", "400", why, Object.assign(base, { errorCode: "IDA_INVALID_REQUEST" }));
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(tenantId)) return bad("no session tenant");
  if (["FORM", "MOBILE"].indexOf(source) < 0) return bad("source must be FORM or MOBILE");
  const keyOk = IDA_KEY_RE.test(key);
  if (op === "STATUS") {
    if (idaId && !digits(idaId)) return bad("ida_id: digits only");
    if (key && !keyOk) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
    if (!digits(idaId) && !keyOk) return bad("STATUS needs ida_id or idempotency_key");
    return answer("CONTINUE", "", "", Object.assign(base, { errorCode: "", idaId: digits(idaId) ? idaId : "0", key: keyOk ? key : "NOKEY", tenantId: tenantId,
      organizationId: org || "0" }));
  }
  if (["Draft", "Completed"].indexOf(saveAs) < 0) return bad("saveAs must be Draft or Completed");
  if (page === "View") return bad("an Item Disassembly in View mode can't be saved");
  if (["Add", "Edit"].indexOf(page) < 0) return bad("pageStatus must be Add, Edit or Clone");
  if (page === "Edit" ? !digits(idaId) : idaId !== "") return bad(page === "Edit" ? "ida_id: digits only" : "ida_id must be empty for Add / Clone");
  if (!keyOk) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  if (!digits(org)) return bad("form.organization_id: digits only");
  return answer("CONTINUE", "", "", Object.assign(base, { errorCode: "", idaId: page === "Edit" ? idaId : "0", key: key, tenantId: tenantId,
    clone: pageIn !== page ? "YES" : "NO", organizationId: org }));
};
// only the form's organization is read here (the keys node takes the record): one copy of a big form less in the run's node data
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], saveAs: [{{workflowparams:saveAs}}][0], pageStatus: [{{workflowparams:pageStatus}}][0],
  idaId: [{{workflowparams:ida_id}}][0], key: [{{workflowparams:idempotency_key}}][0], source: [{{workflowparams:source}}][0],
  organizationId: [{{workflowparams:form.organization_id}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0], uuid: [{{system:uuid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, saveAs: res.saveAs, page: res.pageStatusIn, ida: res.idaId, message: res.message }));
return res;
