// SA_V2_SUBMIT - Guard: operation (SUBMIT | STATUS), source (FORM | REVIEW), saveAs (FORM: Completed), pageStatus (Clone / Copy =
// Add; View refused), sa_id (digits for a FORM Edit, empty for an Add / Clone / review), sc_id (digits for a review), the client's
// idempotency key (one per click and content), the review's organization / nickname / date / createAdjustment, session tenant +
// user. Nothing is read or written for a refused request (INVALID 400 -> the client's classic handler)
const SA_KEY_RE = /^[A-Za-z0-9|:_.-]{8,128}$/;
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const source = s(inp.source).toUpperCase() || "FORM";
  const saveAs = s(inp.saveAs);
  const pageIn = s(inp.pageStatus);
  const page = pageIn === "Clone" || pageIn === "Copy" ? "Add" : pageIn;
  // the client sends every request key on every call ("" when unused; "0" = no SA / SC)
  const saId = s(inp.saId) === "0" ? "" : s(inp.saId);
  const scId = s(inp.scId) === "0" ? "" : s(inp.scId);
  const key = s(inp.key);
  const tenantId = s(inp.tenantId);
  const org = s(inp.organizationId);
  const createAdjustment = s(inp.createAdjustment);
  const nonce = (s(inp.uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const base = { operation: op, source: source, saveAs: saveAs, pageStatus: page, pageStatusIn: pageIn, saId: "0", scId: "0", key: "NOKEY", tenantId: "0", uid: s(inp.uid),
    nonce: nonce, clone: "NO", organizationId: "0", nickname: "", adjustmentDate: "", createAdjustment: "", formScId: "0" };
  const bad = (why) => answer("REJECT", "400", why, Object.assign(base, { errorCode: "SA_INVALID_REQUEST" }));
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(tenantId)) return bad("no session tenant");
  if (["FORM", "REVIEW"].indexOf(source) < 0) return bad("source must be FORM or REVIEW");
  const keyOk = SA_KEY_RE.test(key);
  if (org && !digits(org)) return bad("organization_id: digits only");
  if (op === "STATUS") {
    if (saId && !digits(saId)) return bad("sa_id: digits only");
    if (scId && !digits(scId)) return bad("sc_id: digits only");
    if (key && !keyOk) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
    if (!digits(saId) && !digits(scId) && !keyOk) return bad("STATUS needs sa_id, sc_id or idempotency_key");
    return answer("CONTINUE", "", "", Object.assign(base, { errorCode: "", saId: digits(saId) ? saId : "0", scId: digits(scId) ? scId : "0", key: keyOk ? key : "NOKEY",
      tenantId: tenantId, organizationId: org || "0" }));
  }
  if (!keyOk) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  if (page === "View") return bad("a Stock Adjustment in View mode can't be saved");
  if (source === "FORM") {
    if (saveAs !== "Completed") return bad("saveAs must be Completed");
    if (["Add", "Edit"].indexOf(page) < 0) return bad("pageStatus must be Add, Edit or Clone");
    if (page === "Edit" ? !digits(saId) : saId !== "") return bad(page === "Edit" ? "sa_id: digits only" : "sa_id must be empty for Add / Clone");
    // the Stock Count the record names (a classic review's Draft, or a clone of one): the facts check it for a running review
    return answer("CONTINUE", "", "", Object.assign(base, { errorCode: "", saId: page === "Edit" ? saId : "0", key: key, tenantId: tenantId, clone: pageIn !== page ? "YES" : "NO",
      organizationId: org || "0", formScId: saIdOf(inp.formScId) || "0" }));
  }
  // REVIEW: a NEW Stock Adjustment from a saved Stock Count (the classic Review's request: organizationId, nickname, adjustmentDate,
  // createAdjustment)
  if (!digits(scId)) return bad("sc_id: digits only");
  if (saId !== "") return bad("sa_id must be empty for a review");
  if (!digits(org)) return bad("organization_id: digits only");
  if (["Yes", ""].indexOf(createAdjustment) < 0) return bad("create_adjustment must be Yes or empty");
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}( [0-9]{2}:[0-9]{2}(:[0-9]{2})?)?$/.test(s(inp.adjustmentDate))) return bad("adjustment_date: YYYY-MM-DD");
  return answer("CONTINUE", "", "", Object.assign(base, { errorCode: "", scId: scId, key: key, tenantId: tenantId, organizationId: org, nickname: s(inp.nickname),
    adjustmentDate: s(inp.adjustmentDate), createAdjustment: createAdjustment }));
};
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], source: [{{workflowparams:source}}][0], saveAs: [{{workflowparams:saveAs}}][0],
  pageStatus: [{{workflowparams:pageStatus}}][0], saId: [{{workflowparams:sa_id}}][0], scId: [{{workflowparams:sc_id}}][0], key: [{{workflowparams:idempotency_key}}][0],
  organizationId: [{{workflowparams:organization_id}}][0], nickname: [{{workflowparams:nickname}}][0], adjustmentDate: [{{workflowparams:adjustment_date}}][0],
  createAdjustment: [{{workflowparams:create_adjustment}}][0], formScId: [{{workflowparams:form.stock_count_id}}][0], tenantId: [{{system:tenantId}}][0],
  uid: [{{system:uid}}][0], uuid: [{{system:uuid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, source: res.source, page: res.pageStatusIn, sa: res.saId, sc: res.scId, message: res.message }));
return res;
