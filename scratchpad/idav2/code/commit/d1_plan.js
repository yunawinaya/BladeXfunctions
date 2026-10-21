// IDA_V2_COMMIT - D1 plan (batchMode insert): the BATCH part checked (D1 table row 1 -> FAILED IDA_INVALID_DATA); a recorded intent
// reused (row 2: unreadable -> REQUIRES_REVIEW); else the AUTO numbers from a FRESH batch_number_config read as N sequential GENERATE_BATCH
// calls would answer them (code/shared batchnum.js; row 3: its refusal -> FAILED IDA_BATCH_CONFIG, nothing written); every planned number
// (TYPED + AUTO, insert false included) hex-encoded for BATCH_HOLDERS
const commitD1Plan = function commitD1Plan(entry, partRows, intentRows, bncRows) {
  const base = Object.assign({ route: "GO", hasIntent: "NO", draft: {}, hexSql: "[]", planned: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_IDA" },
    END_EMPTY);
  const part = idaJoinChunks(partRows, entry.partPrefix + "BATCH|");
  const bad = d1PartProblem(entry, part);
  if (bad) return Object.assign(base, failNoWrite(entry, "IDA_INVALID_DATA", MSG.invalid, bad + ": nothing was moved", []));
  const intent = idaJoinChunks(intentRows, "D1|I|");
  let numbers = null;
  if (intent !== null) {
    const why = intent === undefined ? "the recorded D1|I| intent cannot be read" : d1IntentProblem(part, intent);
    if (why) return Object.assign(base, reviewEnd(entry, "D1_BATCH", "IDA_RECONCILIATION_MISMATCH", why));
    numbers = intent.numbers;
    base.hasIntent = "YES";
  } else {
    const autos = part.rows.filter((r) => s(r.kind) === "AUTO");
    const noReq = autos.filter((r) => !r.request || typeof r.request !== "object").map((r) => s(r.key));
    if (noReq.length) return Object.assign(base, failNoWrite(entry, "IDA_INVALID_DATA", MSG.invalid, "AUTO BATCH row(s) " + noReq.slice(0, 5).join(", ") + " carry no numbering request: nothing was moved", []));
    const gen = idaBatchnum(bncRows, part.items || [], autos.map((r) => r.request), Date.now());
    if (gen.error) {
      const at = num(gen.failedAt) >= 0 && autos[num(gen.failedAt)] ? " (AUTO row " + s(autos[num(gen.failedAt)].key) + ")" : "";
      return Object.assign(base, failNoWrite(entry, "IDA_BATCH_CONFIG", s(gen.error).replace(/\.$/, "") + ": nothing was moved", "the batch numbering refused" + at + ": " + s(gen.error), []));
    }
    const nums = list(gen.numbers).map(s);
    if (nums.length !== autos.length || nums.some((n) => n === "")) {
      return Object.assign(base, failNoWrite(entry, "IDA_BATCH_CONFIG", "The batch numbers could not be generated: nothing was moved", "the batch numbering answered " + nums.length + " number(s) for " + autos.length + " AUTO row(s)", []));
    }
    numbers = {};
    autos.forEach((r, i) => { numbers[s(r.key)] = nums[i]; });
    base.draft = { numbers: numbers, configs: list(gen.configs) };
  }
  const planned = part.rows.map((r) => plannedNumber(r, numbers));
  return Object.assign(base, { hexSql: idaHexJson(planned), planned: part.rows.length,
    result_message: part.rows.length + " planned Batch row(s), " + Object.keys(numbers).length + " generated number(s)" + (intent ? " (intent recorded earlier)" : "") });
};
const res = commitD1Plan([{{node:code_node_DCentry.data}}][0], [{{node:sql_node_DCd1part.data}}][0], [{{node:sql_node_DCintent.data}}][0], [{{node:sql_node_DCd1bnc.data}}][0]);
console.log("commit D1 plan", JSON.stringify({ route: res.route, intent: res.hasIntent, planned: res.planned, result: res.result_code, message: res.result_message }));
return res;
