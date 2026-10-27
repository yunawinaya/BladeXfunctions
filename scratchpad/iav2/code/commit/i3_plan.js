// IA_V2_COMMIT - I3 plan (phase B, never unlocks): op 1 must be DONE with no IBA|REVIEW and its stored OUT rows must be as many
// as its code-200 results (a "401" skip has no row and no cost), else REQUIRES_REVIEW IA_RECEIPT_COUNT_MISMATCH (op 2 is never
// started then). The receipt price = q8(sum of the stored OUT total_price / the receipt's base qty + assembly_cost)
// (receiptUnitPrice); R1 = the ENGINE_R movement with that unit_price and I1's batch_id: the same request on every retry
const commitI3Plan = function commitI3Plan(entry, engRRows, outRows, opRows) {
  const base = Object.assign({ route: "GO", needCall: "NO", operationKey: "", movements: [], price: 0, outCount: 0, outTotal: "0", jobRows: [], needJobUpd: "NO", result_code: "",
    result_message: "", job_status: "COMMITTING_IA" }, END_EMPTY);
  const review = (code, why, extra) => Object.assign(base, reviewEnd(entry, "I3_RECEIPT", code, why, extra));
  const eng = iaJoinChunks(engRRows, entry.partPrefix + "ENGINE_R|");
  // R1, or one receipt per output split row (plan 10-27): R1..Rn, each a batch parent's with its group's I1 batch id
  const mvs = eng && typeof eng === "object" && Array.isArray(eng.movements) ? eng.movements : [];
  const r1 = mvs.length && mvs.every((m, i) => s(m.movement_key) === "R" + (i + 1) && s(m.direction) === "ADD") ? mvs[0] : null;
  if (!r1 || s(eng.operation_key) !== iaOpKey(entry.jobId, "R") || s(eng.organization_id) !== entry.organizationId || !((parseFloat(eng.receiptBaseQty) || 0) > 0)) {
    return review("IA_RECONCILIATION_MISMATCH", "the ENGINE_R part of the prepared payload is missing, is not this job's or has no receipt base quantity");
  }
  const out = list(outRows)[0] || {};
  const op = list(opRows)[0] || {};
  const n = num(out.n);
  const total = s(out.total) || "0";
  const op1 = { intents: num(op.intents), review: num(op.review), done: op.done_summary === undefined || op.done_summary === null || s(op.done_summary) === "" ? null : iaParseJ(op.done_summary) };
  if (entry.i2Called === "NO") {
    if (n > 0) return review("IA_RECEIPT_COUNT_MISMATCH", "op 1 was not called (no stock pick) yet " + n + " OUT row(s) carry its key", { stored: n });
  } else {
    if (op1.review > 0) return review("IA_RECEIPT_COUNT_MISMATCH", "op 1 (" + iaOpKey(entry.jobId, "I") + ") is under review (IBA|REVIEW): op 2 is not started", { op1: op1 });
    if (!op1.done || typeof op1.done !== "object") return review("IA_RECEIPT_COUNT_MISMATCH", "op 1 (" + iaOpKey(entry.jobId, "I") + ") has no IBA|DONE row: op 2 is not started", { op1: op1 });
    if (n !== num(op1.done.movements)) {
      return review("IA_RECEIPT_COUNT_MISMATCH", "op 1 stored " + n + " OUT row(s), its DONE row counts " + num(op1.done.movements) + " code-200 result(s)",
        { stored: n, results200: num(op1.done.movements), skipped: num(op1.done.skipped) });
    }
  }
  if (entry.batchMode === "insert" && !digits(entry.batchId)) return review("IA_RECONCILIATION_MISMATCH", "no I1 batch_id for the receipt of a batch-managed assembled item");
  const batchOf = eng.batchOf && typeof eng.batchOf === "object" ? eng.batchOf : null;
  const ids = entry.batchIds && typeof entry.batchIds === "object" ? entry.batchIds : {};
  const idOf = (m) => (batchOf ? s(ids[batchKey(batchOf[s(m.movement_key)])]) : s(entry.batchId));
  if (entry.batchMode === "insert" && mvs.some((m) => !digits(idOf(m)))) {
    return review("IA_RECONCILIATION_MISMATCH", "no I1 batch_id for an output split receipt's batch (" + mvs.filter((m) => !digits(idOf(m))).map((m) => s(m.movement_key)).join(", ") + ")");
  }
  const price = receiptUnitPrice({ outTotals: [total], receiptBaseQty: eng.receiptBaseQty, assemblyCost: eng.assemblyCost });
  const movements = mvs.map((m) => {
    const mv = Object.assign({}, m, { unit_price: price });
    if (entry.batchMode === "insert") mv.batch_id = idOf(m);
    return mv;
  });
  return Object.assign(base, { needCall: "YES", operationKey: s(eng.operation_key), movements: movements, price: price, outCount: n, outTotal: total,
    result_message: "receipt at " + price + " = (" + total + " over " + n + " OUT row(s)) / " + s(eng.receiptBaseQty) + " + " + s(eng.assemblyCost) });
};
const res = commitI3Plan([{{node:code_node_IACentry.data}}][0], [{{node:sql_node_IACi3engr.data}}][0], [{{node:sql_node_IACi3out.data}}][0], [{{node:sql_node_IACop1.data}}][0]);
console.log("commit I3 plan", JSON.stringify({ route: res.route, price: res.price, rows: res.outCount, result: res.result_code, message: res.result_message }));
return res;
