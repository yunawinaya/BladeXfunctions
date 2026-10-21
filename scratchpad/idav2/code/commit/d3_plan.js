// IDA_V2_COMMIT - D3 plan (phase B, never unlocks): op 1 must be DONE with no IBA|REVIEW, its stored OUT rows as many as its code-200
// results and no "401" skip (a skipped pick issued nothing), else REQUIRES_REVIEW IDA_RECEIPT_COUNT_MISMATCH (op 2 is never started
// then). The issued value = the stored OUT rows' total (OUT_TOTALS, summed in SQL); idaAllocate shares it over EVERY recovery line (the
// classic code_cost_alloc rule, v7's per-base-unit price); each R movement gets its line's unit_price and, for a batch line, the
// Batch row of ours (oursByKey[batch_key]) - the same request on every retry
const commitD3Plan = function commitD3Plan(entry, engRRows, outRows, opRows, partRows, intentRows, oursRows) {
  const base = Object.assign({ route: "GO", needCall: "NO", operationKey: "", movements: [], keys: [], moveCount: 0, issued: "0", outCount: 0, outTotal: "0", jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_IDA" }, END_EMPTY);
  const review = (code, why, extra) => Object.assign(base, reviewEnd(entry, "D3_RECEIPT", code, why, extra));
  const eng = idaJoinChunks(engRRows, entry.partPrefix + "ENGINE_R|");
  if (!eng || typeof eng !== "object" || s(eng.operation_key) !== idaOpKey(entry.jobId, "R") || s(eng.organization_id) !== entry.organizationId || !Array.isArray(eng.movements)
    || !eng.movements.length || !Array.isArray(eng.alloc) || !eng.alloc.length) {
    return review("IDA_RECONCILIATION_MISMATCH", "the ENGINE_R part of the prepared payload is missing, is not this job's or holds no movement / alloc");
  }
  const allocAt = {};
  const twice = [];
  eng.alloc.forEach((a, i) => {
    const k = s(a && a.movement_key);
    if (!k) return;
    if (allocAt[k] !== undefined) twice.push(k);
    allocAt[k] = i;
  });
  const orphan = eng.movements.map((m) => s(m && m.movement_key)).filter((k) => allocAt[k] === undefined);
  if (twice.length || orphan.length) return review("IDA_RECONCILIATION_MISMATCH", "the ENGINE_R alloc does not name every receipt exactly once (" + twice.concat(orphan).slice(0, 5).join(", ") + ")");
  const out = list(outRows)[0] || {};
  const op = list(opRows)[0] || {};
  const n = num(out.n);
  const total = s(out.total) || "0";
  const done = s(op.done_summary) === "" ? null : idaParseJ(op.done_summary);
  const op1 = { intents: num(op.intents), review: num(op.review), done: done && typeof done === "object" ? done : null };
  if (op1.review > 0) return review("IDA_RECEIPT_COUNT_MISMATCH", "op 1 (" + idaOpKey(entry.jobId, "I") + ") is under review (IBA|REVIEW): op 2 is not started", { op1: op1 });
  if (!op1.done) return review("IDA_RECEIPT_COUNT_MISMATCH", "op 1 (" + idaOpKey(entry.jobId, "I") + ") has no IBA|DONE row: op 2 is not started", { op1: op1 });
  if (n !== num(op1.done.movements)) {
    return review("IDA_RECEIPT_COUNT_MISMATCH", "op 1 stored " + n + " OUT row(s), its DONE row counts " + num(op1.done.movements) + " code-200 result(s): op 2 is not started",
      { stored: n, results200: num(op1.done.movements), skipped: num(op1.done.skipped) });
  }
  if (num(op1.done.skipped) > 0) {
    return review("IDA_RECEIPT_COUNT_MISMATCH", "op 1 skipped " + num(op1.done.skipped) + " source pick(s) (the engine answered 401, so nothing was issued for them): op 2 is not started",
      { op1: op1 });
  }
  const keyed = eng.alloc.filter((a) => a && s(a.movement_key) && s(a.batch_key));
  let byKey = {};
  if (entry.batchMode === "insert") {
    const part = idaJoinChunks(partRows, entry.partPrefix + "BATCH|");
    const intent = idaJoinChunks(intentRows, "D1|I|");
    if (!part || typeof part !== "object" || !Array.isArray(part.rows) || !intent || typeof intent !== "object" || !intent.numbers) {
      return review("IDA_RECONCILIATION_MISMATCH", "the BATCH part or the D1 intent cannot be read: the receipts' Batch rows are unknown");
    }
    const om = oursMap(part.rows, intent.numbers, oursRows, entry.jobId, entry.idaNo);
    byKey = om.byKey;
    const off = keyed.filter((a) => !byKey[s(a.batch_key)]).map((a) => s(a.movement_key) + " -> " + s(a.batch_key));
    if (off.length || om.extra.length) {
      return review("IDA_RECONCILIATION_MISMATCH", (off.length ? off.length + " batch line(s) without their Batch row of this job (" + off.slice(0, 5).join(", ") + ")" : "")
        + (om.extra.length ? (off.length ? "; " : "") + om.extra.length + " Batch row(s) of this job beyond their planned rows" : ""));
    }
  } else if (keyed.length) return review("IDA_RECONCILIATION_MISMATCH", keyed.length + " receipt(s) name a BATCH row although the plan holds none");
  const prices = idaAllocate(total, eng.alloc);
  const movements = eng.movements.map((m) => {
    const a = eng.alloc[allocAt[s(m.movement_key)]];
    const o = Object.assign({}, m, { unit_price: prices[allocAt[s(m.movement_key)]].unit_price });
    if (s(a.batch_key)) o.batch_id = byKey[s(a.batch_key)];
    return o;
  });
  return Object.assign(base, { needCall: "YES", operationKey: s(eng.operation_key), movements: movements, keys: movements.map((m) => s(m.movement_key)), moveCount: movements.length,
    issued: total, outCount: n, outTotal: total, result_message: movements.length + " receipt(s) priced from " + total + " over " + n + " OUT row(s), shared by " + eng.alloc.length + " recovery line(s)" });
};
const res = commitD3Plan([{{node:code_node_DCentry.data}}][0], [{{node:sql_node_DCd3engr.data}}][0], [{{node:sql_node_DCd3out.data}}][0], [{{node:sql_node_DCop1.data}}][0],
  [{{node:sql_node_DCd3part.data}}][0], [{{node:sql_node_DCintent.data}}][0], [{{node:sql_node_DCd3ours.data}}][0]);
console.log("commit D3 plan", JSON.stringify({ route: res.route, movements: res.moveCount, rows: res.outCount, total: res.outTotal, result: res.result_code, message: res.result_message }));
return res;
