// IDA_V2_COMMIT - D1 decide (rows 3-8) against the organization's live Batch rows holding a planned number (BATCH_HOLDERS, compared as
// utf8mb4_general_ci). No intent: every holder is foreign - a generated number held -> FAILED IDA_BATCH_DUPLICATE (GENERATE_BATCH's
// refusal: no config advanced), a TYPED one -> the same with code_validate's wording (the LABELS part words it). With an intent: a config
// it names gone -> FAILED IDA_BATCH_CONFIG; a holder that is not ours -> FAILED IDA_BATCH_DUPLICATE; a planned row with two of ours ->
// FAILED IDA_BATCH_FAILED (each with ours soft-deleted). Else: the intent (when none, BEFORE any write), the configs forward only, and
// the planned rows with insert true and no ours (add_node_F9KqZLfd's columns, slices of 250)
const commitD1Decide = function commitD1Decide(entry, plan, partRows, intentRows, bncRows, holderRows) {
  const base = Object.assign({ route: "GO", intentRows: [], needIntent: "NO", bncRows: [], needBnc: "NO", insertSlices: [], insertCount: 0, adoptCount: 0, needEngR: "NO", needLabels: "NO",
    labelLine: "", labelItem: "", labelNumber: "", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_IDA" }, END_EMPTY);
  const part = idaJoinChunks(partRows, entry.partPrefix + "BATCH|");
  const recorded = s(plan.hasIntent) === "YES";
  const intent = recorded ? idaJoinChunks(intentRows, "D1|I|") : plan.draft;
  if (d1PartProblem(entry, part) || !intent || typeof intent !== "object" || !intent.numbers || !Array.isArray(intent.configs)) {
    return Object.assign(base, failNoWrite(entry, "IDA_INVALID_DATA", MSG.invalid, "the BATCH part or the batch intent is unusable at D1 decide: nothing was moved", []));
  }
  const numbers = intent.numbers;
  const holders = idaRows(holderRows);
  const fresh = configsOf(bncRows);
  const where = (o) => "Batch row " + s(o.id) + " (" + (s(o.transaction_no) || "no transaction") + ")";
  const om = recorded ? oursMap(part.rows, numbers, holders, entry.jobId, entry.idaNo) : { byKey: {}, all: [], extra: [], missing: [] };
  if (!recorded) {
    const autoKeys = {};
    const typedRows = {};
    for (const r of part.rows) {
      const n = plannedNumber(r, numbers);
      if (s(r.kind) === "AUTO") autoKeys[idaBatchKey(n)] = n;
      else if (!typedRows[idaBatchKey(n)]) typedRows[idaBatchKey(n)] = r;
    }
    const gen = holders.find((o) => autoKeys[idaBatchKey(o.batch_number)] !== undefined || !typedRows[idaBatchKey(o.batch_number)]);
    if (gen) {
      const n = autoKeys[idaBatchKey(gen.batch_number)] || heldNumber(part.rows, numbers, gen).number;
      return Object.assign(base, failNoWrite(entry, "IDA_BATCH_DUPLICATE", IDA_TEXT.batchDuplicate(n), "generated batch number " + n + " is held by " + where(gen) + ": nothing was moved", []));
    }
    const typed = holders.find((o) => typedRows[idaBatchKey(o.batch_number)]);
    if (typed) {
      const r = typedRows[idaBatchKey(typed.batch_number)];
      const n = plannedNumber(r, numbers);
      return Object.assign(base, failNoWrite(entry, "IDA_BATCH_DUPLICATE", IDA_TEXT.typedTaken(idaLineLabel("?", { item_selection: s(r.material_id) }), n),
        "typed batch number " + n + " is held by " + where(typed) + ": nothing was moved", []), { needLabels: "YES", labelLine: s(list(r.line_ids)[0]), labelItem: s(r.material_id), labelNumber: n });
    }
  } else {
    const gone = intent.configs.filter((c) => !fresh[s(c.id)]).map((c) => s(c.id));
    if (gone.length) {
      return Object.assign(base, failNoWrite(entry, "IDA_BATCH_CONFIG", "batch number configuration " + gone[0] + " no longer exists: nothing was moved", "batch number configuration(s) " + gone.join(", ")
        + " of the recorded intent are gone: nothing was moved", om.all));
    }
    const mine = setOf(om.all);
    const foreign = holders.filter((o) => !mine[s(o.id)]);
    if (foreign.length) {
      const n = heldNumber(part.rows, numbers, foreign[0]).number;
      return Object.assign(base, failNoWrite(entry, "IDA_BATCH_DUPLICATE", IDA_TEXT.batchDuplicate(n), "batch number " + n + " is held by " + where(foreign[0]) + ", not this job's: nothing was moved", om.all));
    }
    if (om.extra.length) {
      return Object.assign(base, failNoWrite(entry, "IDA_BATCH_FAILED", IDA_TEXT.batchFailed("inserted twice"), om.extra.length + " Batch row(s) of this job beyond their planned rows (" + om.extra.slice(0, 5).join(", ")
        + "): nothing was moved", om.all));
    }
  }
  for (const c of intent.configs) {
    const cur = fresh[s(c.id)];
    if (!cur) return Object.assign(base, failNoWrite(entry, "IDA_BATCH_CONFIG", "batch number configuration " + s(c.id) + " no longer exists: nothing was moved", "the numbering read a configuration that is gone", om.all));
    const w = cfgWrite(cur, c);
    if (w) base.bncRows.push(w);
  }
  const ins = part.rows.filter((r) => r.insert !== false && !om.byKey[s(r.key)]).map((r) => batchRowOf(entry, r, numbers));
  const adopted = part.rows.filter((r) => r.insert !== false && om.byKey[s(r.key)]).length;
  base.intentRows = recorded ? [] : intentRowsOf(entry, { numbers: numbers, configs: intent.configs });
  base.needIntent = base.intentRows.length ? "YES" : "NO";
  base.needBnc = base.bncRows.length ? "YES" : "NO";
  return Object.assign(base, { insertSlices: slicesOf(ins, SLICE), insertCount: ins.length, adoptCount: adopted, needEngR: part.rows.some((r) => r.insert !== false) ? "YES" : "NO",
    result_message: ins.length + " Batch row(s) to insert, " + adopted + " adopted, " + base.bncRows.length + " configuration(s) to advance" + (recorded ? " (intent recorded earlier)" : "") });
};
const res = commitD1Decide([{{node:code_node_DCentry.data}}][0], [{{node:code_node_DCd1plan.data}}][0], [{{node:sql_node_DCd1part.data}}][0], [{{node:sql_node_DCintent.data}}][0],
  [{{node:sql_node_DCd1bnc.data}}][0], [{{node:sql_node_DCd1hold.data}}][0]);
console.log("commit D1 decide", JSON.stringify({ route: res.route, intent: res.needIntent, configs: res.bncRows.length, inserts: res.insertCount, adopted: res.adoptCount, result: res.result_code, message: res.result_message }));
return res;
