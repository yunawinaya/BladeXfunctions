// IA_V2_COMMIT - I1 decide (batch parent, mode insert): ours = an earlier pass of this job inserted it (the intent's identity,
// id > job) -> adopt; two -> FAILED, both soft-deleted; else a live Batch row of the parent with the same number that is not
// ours -> FAILED IA_BATCH_DUPLICATE (GENERATE_BATCH's own check: batch_number_config has no lock); else the intent row (before
// the insert) and ONE Batch row with add_node_F9KqZLfd's columns
const BATCH_COLS = __BATCHCOLS__;
const commitI1Decide = function commitI1Decide(entry, partRows, engRRows, batchRows) {
  const base = Object.assign({ route: "GO", identity: {}, ours: [], intentRows: [], needIntent: "NO", insertRows: [], needInsert: "NO", r1: {}, opKeyR: "", jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_IA" }, END_EMPTY);
  const part = iaJoinChunks(partRows, entry.partPrefix + "BATCH|");
  const eng = iaJoinChunks(engRRows, entry.partPrefix + "ENGINE_R|");
  const row = part && typeof part === "object" && part.row && typeof part.row === "object" ? part.row : null;
  const r1 = eng && typeof eng === "object" && Array.isArray(eng.movements) && eng.movements.length === 1 ? eng.movements[0] : null;
  const bad = [];
  if (!row || s(part.mode) !== "insert") bad.push("the BATCH part is missing or not mode insert");
  else {
    if (!s(row.batch_number)) bad.push("the planned Batch row has no number");
    if (s(row.material_id) !== entry.parentItemId) bad.push("the planned Batch row is for item " + s(row.material_id) + ", the assembled item is " + entry.parentItemId);
    if (s(row.organization_id) !== entry.organizationId || !digits(row.plant_id)) bad.push("the planned Batch row's organization / plant");
    if (s(row.transaction_no) !== entry.iaNo) bad.push("the planned Batch row's transaction_no " + s(row.transaction_no) + " is not " + entry.iaNo);
  }
  if (!r1 || s(eng.operation_key) !== iaOpKey(entry.jobId, "R") || s(eng.organization_id) !== entry.organizationId || s(r1.movement_key) !== "R1" || s(r1.direction) !== "ADD") {
    bad.push("the ENGINE_R part is missing or not this job's");
  }
  if (bad.length) return Object.assign(base, failNoWrite(entry, "IA_INVALID_DATA", MSG.invalid, bad.join("; ") + ": no stock was moved", []));
  if (entry.hasIntent === "BAD") return Object.assign(base, reviewEnd(entry, "I1_BATCH", "IA_RECONCILIATION_MISMATCH", "the recorded I1|I|001 intent cannot be read"));
  const idt = identityOf(row);
  const intent = entry.hasIntent === "YES" ? entry.intent : null;
  if (intent && !sameIdentity(intent, idt)) return Object.assign(base, reviewEnd(entry, "I1_BATCH", "IA_RECONCILIATION_MISMATCH", "the recorded intent " + JSON.stringify(intent) + " is not the BATCH part's row"));
  const out = { identity: idt, r1: r1, opKeyR: s(eng.operation_key) };
  const ours = intent ? oursOf(batchRows, idt, entry.jobId) : [];
  if (ours.length > 1) return Object.assign(base, out, failNoWrite(entry, "IA_BATCH_FAILED", MSG.batchTwice, ours.length + " Batch rows " + idt.batch_number + " of this job (" + ours.join(", ") + "): nothing was moved", ours));
  if (ours.length === 1) return Object.assign(base, out, { ours: ours, result_message: "Batch row " + ours[0] + " of an earlier pass adopted" });
  const taken = iaRows(batchRows).filter((o) => batchKey(o.batch_number) === batchKey(idt.batch_number));
  if (taken.length) {
    return Object.assign(base, out, failNoWrite(entry, "IA_BATCH_DUPLICATE", IA_TEXT.batchDuplicate, "batch number " + idt.batch_number + " is held by Batch row " + s(taken[0].id) + " (" + (s(taken[0].transaction_no) || "no transaction") + "): no stock was moved", []));
  }
  const ins = {};
  for (const k of BATCH_COLS) ins[k] = row[k] === undefined ? null : row[k];
  ins.initial_quantity = iaQtyStr(row.initial_quantity);
  const intentRows = intent ? [] : [Object.assign(doneRow(entry, "I1|I|001", JSON.stringify(idt)), { step_status: "INTENT" })];
  return Object.assign(base, out, { intentRows: intentRows, needIntent: intentRows.length ? "YES" : "NO", insertRows: [ins], needInsert: "YES",
    result_message: "Batch row " + idt.batch_number + " to insert" + (intent ? " (intent recorded earlier)" : "") });
};
const res = commitI1Decide([{{node:code_node_IACentry.data}}][0], [{{node:sql_node_IACi1part.data}}][0], [{{node:sql_node_IACi1engr.data}}][0], [{{node:sql_node_IACi1rows.data}}][0]);
console.log("commit I1 decide", JSON.stringify({ route: res.route, ours: res.ours, intent: res.needIntent, insert: res.needInsert, result: res.result_code, message: res.result_message }));
return res;
