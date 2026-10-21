// LOT_V2_SUBMIT - Guard: operation (SUBMIT | STATUS), saveAs, pageStatus (Clone / Copy = Add), lot_id (digits for Edit and STATUS,
// empty for Add), the client's idempotency key (one per click and content), source, session tenant + user (the form is read by keys)
const submitGuard = function submitGuard(inp) {
  const op = s(inp.operation).toUpperCase() || "SUBMIT";
  const saveAs = s(inp.saveAs);
  const pageIn = s(inp.pageStatus);
  const page = pageIn === "Clone" || pageIn === "Copy" ? "Add" : pageIn;
  const lotId = s(inp.lotId);
  const key = s(inp.key);
  const tenantId = s(inp.tenantId);
  const nonce = (s(inp.uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const bad = (why) => answer("REJECT", "400", why, { errorCode: "LOT_INVALID_REQUEST", operation: op, saveAs: saveAs, pageStatus: page, pageStatusIn: pageIn, lotId: "0",
    key: "NOKEY", tenantId: "0", uid: "", source: "FORM", nonce: nonce, clone: "NO", draftAdd: "NO" });
  if (["SUBMIT", "STATUS"].indexOf(op) < 0) return bad("operation must be SUBMIT or STATUS");
  if (!digits(tenantId)) return bad("no session tenant");
  const keyOk = /^[A-Za-z0-9|:_.-]{8,128}$/.test(key);
  if (op === "STATUS") {
    if (!digits(lotId)) return bad("lot_id: digits only");
    if (key && !keyOk) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
    return answer("CONTINUE", "", "", { operation: op, saveAs: saveAs, pageStatus: page, pageStatusIn: pageIn, lotId: lotId, key: key || "NOKEY", tenantId: tenantId,
      uid: s(inp.uid), source: s(inp.source) || "FORM", nonce: nonce, clone: "NO", draftAdd: "NO" });
  }
  if (["Draft", "In Progress", "Completed", "Cancelled"].indexOf(saveAs) < 0) return bad("saveAs must be Draft, In Progress, Completed or Cancelled");
  if (["Add", "Edit"].indexOf(page) < 0) return bad("pageStatus must be Add, Edit or Clone");
  if (page === "Add" && saveAs === "Cancelled") return bad("a new Location Transfer can't be cancelled");
  if (page === "Edit" ? !digits(lotId) : lotId !== "") return bad(page === "Edit" ? "lot_id: digits only" : "lot_id must be empty for Add / Clone");
  if (!keyOk) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  if (["FORM", "LIST", ""].indexOf(s(inp.source)) < 0) return bad("source must be FORM or LIST");
  return answer("CONTINUE", "", "", { operation: op, saveAs: saveAs, pageStatus: page, pageStatusIn: pageIn, lotId: page === "Edit" ? lotId : "0", key: key, tenantId: tenantId,
    uid: s(inp.uid), source: s(inp.source) || "FORM", nonce: nonce, clone: pageIn !== page ? "YES" : "NO", draftAdd: page === "Add" && saveAs === "Draft" ? "YES" : "NO" });
};
const res = submitGuard({ operation: [{{workflowparams:operation}}][0], saveAs: [{{workflowparams:saveAs}}][0], pageStatus: [{{workflowparams:pageStatus}}][0],
  lotId: [{{workflowparams:lot_id}}][0], key: [{{workflowparams:idempotency_key}}][0], source: [{{workflowparams:source}}][0],
  tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0], uuid: [{{system:uuid}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, op: res.operation, saveAs: res.saveAs, page: res.pageStatusIn, lot: res.lotId, message: res.message }));
return res;
