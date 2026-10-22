// IDA_V2_COMMIT - D1 check (rows 7, 9, 10, 11) on the read-back: the intent recorded, every planned row with insert true holding
// exactly its own Batch row (ours), the configs at least at their after-state - else retry, after 3 FAILED IDA_BATCH_FAILED; a planned
// row inserted twice -> FAILED IDA_BATCH_FAILED; the controller's post-insert re-check: ANY other live org Batch row holding one of our
// numbers -> FAILED IDA_BATCH_DUPLICATE, or the renumber exit when only generated numbers are taken (each with ours soft-deleted).
// Then the re-PLAN of op 2 with the real batch ids (skipped when no planned row inserts)
const commitD1Check = function commitD1Check(entry, partRows, intentRows, bncRows, holderRows, engRRows) {
  const base = Object.assign({ route: "GO", ours: [], needPlan: "NO", planKey: "", planMovements: [], keys: [], planCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "",
    job_status: "COMMITTING_IDA" }, END_EMPTY);
  const part = idaJoinChunks(partRows, entry.partPrefix + "BATCH|");
  const intent = idaJoinChunks(intentRows, "D1|I|");
  const retry = (why, what, ours) => (num(entry.attempts) >= MAX_RETRIES
    ? failNoWrite(entry, "IDA_BATCH_FAILED", IDA_TEXT.batchFailed(what), why + " (after " + num(entry.attempts) + " retries): nothing was moved", ours)
    : stepEnd(entry, "D1_BATCH", why, false));
  if (d1PartProblem(entry, part)) return Object.assign(base, failNoWrite(entry, "IDA_INVALID_DATA", MSG.invalid, "the BATCH part is unusable at D1 check: nothing was moved", []));
  if (!intent || typeof intent !== "object" || !intent.numbers || !Array.isArray(intent.configs)) return Object.assign(base, retry("the D1 intent did not read back", "intent not recorded", []));
  const holders = idaRows(holderRows);
  const om = oursMap(part.rows, intent.numbers, holders, entry.jobId, entry.idaNo);
  base.ours = om.all;
  if (om.extra.length) {
    return Object.assign(base, failNoWrite(entry, "IDA_BATCH_FAILED", IDA_TEXT.batchFailed("inserted twice"), om.extra.length + " Batch row(s) of this job beyond their planned rows (" + om.extra.slice(0, 5).join(", ")
      + "): nothing was moved", om.all));
  }
  const mine = setOf(om.all);
  const foreign = holders.filter((o) => !mine[s(o.id)]);
  if (foreign.length) {
    const n = heldNumber(part.rows, intent.numbers, foreign[0]).number;
    const why = "after the insert batch number " + n + " is also held by Batch row " + s(foreign[0].id) + " (" + (s(foreign[0].transaction_no) || "no transaction") + "): nothing was moved";
    const taken = d1Taken(part.rows, intent.numbers, foreign);
    if (d1CanRenumber(entry, taken, intentRows)) return Object.assign(base, d1Renumber(entry, taken, why, om.all, intentRows, d1Wait(holders, om.all, foreign)));
    return Object.assign(base, failNoWrite(entry, "IDA_BATCH_DUPLICATE", IDA_TEXT.batchDuplicate(n), why, om.all));
  }
  if (om.missing.length) return Object.assign(base, retry(om.missing.length + " planned Batch row(s) did not read back after the insert (e.g. " + om.missing.slice(0, 5).join(", ") + ")", "missing after the insert", om.all));
  const fresh = configsOf(bncRows);
  const behind = intent.configs.filter((c) => !fresh[s(c.id)] || cfgBehind(fresh[s(c.id)], c)).map((c) => s(c.id));
  if (behind.length) return Object.assign(base, retry(behind.length + " batch number configuration(s) behind their after-state (" + behind.slice(0, 5).join(", ") + ")", "configuration behind", om.all));
  const inserting = part.rows.filter((r) => r.insert !== false).length;
  if (!inserting) return Object.assign(base, { result_message: "no planned row inserts a Batch row: the re-PLAN is skipped" });
  const eng = idaJoinChunks(engRRows, entry.partPrefix + "ENGINE_R|");
  if (!eng || typeof eng !== "object" || s(eng.operation_key) !== idaOpKey(entry.jobId, "R") || s(eng.organization_id) !== entry.organizationId || !Array.isArray(eng.movements) || !eng.movements.length
    || !Array.isArray(eng.alloc)) {
    return Object.assign(base, failNoWrite(entry, "IDA_INVALID_DATA", MSG.invalid, "the ENGINE_R part of the prepared payload is missing or is not this job's: nothing was moved", om.all));
  }
  const keyOf = {};
  for (const a of eng.alloc) if (a && s(a.movement_key)) keyOf[s(a.movement_key)] = s(a.batch_key);
  const off = [];
  const movements = eng.movements.map((m) => {
    const k = s(m && m.movement_key);
    if (keyOf[k] === undefined) off.push(k + " (no alloc entry)");
    const out = Object.assign({}, m, { unit_price: 0 });
    if (keyOf[k]) {
      if (!om.byKey[keyOf[k]]) off.push(k + " -> " + keyOf[k]);
      out.batch_id = om.byKey[keyOf[k]] || null;
    }
    return out;
  });
  if (off.length) {
    return Object.assign(base, failNoWrite(entry, "IDA_INVALID_DATA", MSG.invalid, off.length + " receipt movement(s) without their Batch row (" + off.slice(0, 5).join(", ") + "): nothing was moved", om.all));
  }
  return Object.assign(base, { needPlan: "YES", planKey: s(eng.operation_key), planMovements: movements, keys: movements.map((m) => s(m.movement_key)), planCount: movements.length,
    result_message: om.all.length + " Batch row(s) of this job read back; re-PLAN of " + movements.length + " receipt(s)" });
};
const res = commitD1Check([{{node:code_node_DCentry.data}}][0], [{{node:sql_node_DCd1part.data}}][0], [{{node:sql_node_DCd1intentB.data}}][0], [{{node:sql_node_DCd1bncB.data}}][0],
  [{{node:sql_node_DCd1holdB.data}}][0], [{{node:sql_node_DCd1engr.data}}][0]);
console.log("commit D1 check", JSON.stringify({ route: res.route, ours: res.ours.length, plan: res.needPlan, movements: res.planCount, result: res.result_code, message: res.result_message }));
return res;
