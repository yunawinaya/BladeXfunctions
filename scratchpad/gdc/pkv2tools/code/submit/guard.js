// PICKING_ASYNC_SUBMIT - Guard: the inputs, the request's shape (at most 2,000 lines), the session tenant
const MAX_LINES = 2000;
const submitGuard = function submitGuard(input) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const inp = input || {};
  const tenantId = s(inp.systemTenantId);
  const pickingId = s(inp.pickingId);
  const org = s(inp.organizationId);
  const op = s(inp.operation).toUpperCase() || "CONFIRM";
  const key = s(inp.idempotencyKey);
  const bad = (why) => ({ route: "REJECT", tenantId: "0", pickingId: "0", organizationId: "0", operation: op, idempotencyKey: "", request: "", lineCount: 0, result_code: "400", result_message: why });
  if (!/^[0-9]{1,20}$/.test(tenantId)) return bad("no session tenant");
  if (!/^[0-9]{1,20}$/.test(pickingId)) return bad("picking_id: digits only");
  if (!/^[0-9]{1,20}$/.test(org)) return bad("organization_id: digits only");
  // STATUS: read-only, the Picking's latest job for the form (the browser cannot read gd_async_job itself)
  if (op === "STATUS") return { route: "STATUS", tenantId: tenantId, pickingId: pickingId, organizationId: org, operation: op, idempotencyKey: "", request: "", lineCount: 0, result_code: "", result_message: "" };
  if (!/^[A-Za-z0-9:_|-]{16,128}$/.test(key)) return bad("idempotency_key: 16-128 of A-Z a-z 0-9 : _ | -");
  if (op !== "CONFIRM" && op !== "PICK_ALL_REMAINING") return bad("operation must be CONFIRM or PICK_ALL_REMAINING");
  let payload = inp.payload;
  if (typeof payload === "string") {
    try {
      payload = payload ? JSON.parse(payload) : {};
    } catch (e) {
      return bad("payload is not valid JSON");
    }
  }
  payload = payload && typeof payload === "object" ? payload : {};
  const id = (v) => (/^[0-9]{1,20}$/.test(s(v)) ? s(v) : "");
  const lines = [];
  for (const ln of Array.isArray(payload.lines) ? payload.lines : []) {
    const rowId = id(ln && ln.row_id);
    const qty = Number(ln && ln.qty);
    if (!rowId) return bad("a line has no row_id");
    if (!isFinite(qty) || qty < 0) return bad("line " + rowId + ": the picked quantity is not a number");
    if (qty === 0) continue;
    // a unit / bin / batch that is not an id would silently pick in the order unit or from the wrong place: refuse it
    for (const k of ["pick_uom", "target_location_id", "target_batch_id"]) if (s(ln[k]) && !id(ln[k])) return bad("line " + rowId + ": " + k + " is not an id");
    const out = { row_id: rowId, qty: qty, pick_uom: id(ln.pick_uom) };
    // sent = the form's value ("" = no move); not sent = PREPARE reads the stored line
    for (const k of ["target_location_id", "target_batch_id"]) if (Object.prototype.hasOwnProperty.call(ln, k)) out[k] = id(ln[k]);
    for (const k of ["remark", "remark_2", "remark_3"]) if (ln[k] !== undefined && ln[k] !== null) out[k] = String(ln[k]);
    if (Array.isArray(ln.attachment)) out.attachment = ln.attachment;
    lines.push(out);
  }
  if (op === "CONFIRM" && !lines.length) return bad("Cannot complete picking. At least one item must have picked quantity greater than 0.");
  if (lines.length > MAX_LINES) return bad("this confirmation has " + lines.length + " picked lines; the maximum is " + MAX_LINES);
  const headerPatch = payload.header_patch && typeof payload.header_patch === "object" && !Array.isArray(payload.header_patch) ? payload.header_patch : {};
  const request = { v: 1, operation: op, picking_id: pickingId, confirmed_by: s(inp.confirmedBy).slice(0, 100), lines: op === "CONFIRM" ? lines : [], header_patch: headerPatch };
  return { route: "CONTINUE", tenantId: tenantId, pickingId: pickingId, organizationId: org, operation: op, idempotencyKey: key, request: JSON.stringify(request), lineCount: request.lines.length, result_code: "", result_message: "" };
};
const res = submitGuard({ pickingId: [{{workflowparams:picking_id}}][0], organizationId: [{{workflowparams:organization_id}}][0], operation: [{{workflowparams:operation}}][0], idempotencyKey: [{{workflowparams:idempotency_key}}][0], payload: [{{workflowparams:payload}}][0], confirmedBy: [{{workflowparams:confirmed_by}}][0], systemTenantId: [{{system:tenantId}}][0] });
console.log("submit guard", JSON.stringify({ route: res.route, picking: res.pickingId, op: res.operation, lines: res.lineCount, message: res.result_message }));
return res;
