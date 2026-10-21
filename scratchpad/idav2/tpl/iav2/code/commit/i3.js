// IA_V2_COMMIT - I3 RECEIPT: APPLY of op 2 (IAC|<job>|R). 200 (also REPLAYED) with R1 "200" -> DONE + progress 80; R1 any
// other code (incl. "401") -> REQUIRES_REVIEW IA_RECEIPT_REFUSED (never Completed without a receipt); 409, no answer, a 400
// without a result_code -> wait 10 s (not counted) until 1,800 s after I3's FIRST transient answer (error_details.waitFrom,
// ruling 10 R4; the runbook's reset clears it), then REQUIRES_REVIEW IA_RECEIPT_TIMEOUT; a 400 with a result_code or a 500 ->
// REQUIRES_REVIEW IA_RECEIPT_REFUSED
const commitI3 = function commitI3(entry, plan, ans, ops) {
  const extra = { progressRows: [], needProgress: "NO" };
  const code = s(ans.code);
  const rc = s(ans.result_code);
  const why = engineWhy("INVENTORY_BULK_APPLY (" + iaOpKey(entry.jobId, "R") + ")", ans);
  if (code === "200" && s(ans.r1Code) === "200") {
    const ok = stepOk(entry, "I3_RECEIPT", JSON.stringify({ unit_price: plan.price, out_rows: num(plan.outCount), out_total: s(plan.outTotal), result_code: rc }), "assembled item received at " + plan.price);
    return Object.assign(ok, { progressRows: [jobRow(entry, { progress_percent: 80, progress_message: P80 })], needProgress: "YES" });
  }
  if (code === "200") return Object.assign(reviewEnd(entry, "I3_RECEIPT", "IA_RECEIPT_REFUSED", why + "; R1 answered " + (s(ans.r1Code) || "nothing") + (s(ans.r1Message) ? ": " + s(ans.r1Message) : ""),
    { r1: s(ans.r1Code) }), extra);
  if (code === "409" || code === "" || (code === "400" && !rc)) {
    const intents = num((ops || {}).intents);
    const now = endNow(entry);
    let from = s(entry.waitFrom) || now;
    let waited = iaDbSeconds(from, now);
    if (!(waited >= 0)) {
      from = now;
      waited = 0;
    }
    if (waited > IA_RECEIPT_WAIT_S) {
      return Object.assign(reviewEnd(entry, "I3_RECEIPT", "IA_RECEIPT_TIMEOUT", "op 2 not applied " + Math.round(waited) + " s after its first transient answer (" + from + "): " + why,
        { waitFrom: from, waited: Math.round(waited), intents: intents, i2DoneAt: s(entry.i2DoneAt) }), extra);
    }
    return Object.assign(stepWait(entry, "I3_RECEIPT", why + (intents ? " (" + intents + " intent row(s))" : ""), IA_RECEIPT_RETRY_S, { waitFrom: from, waited: Math.round(waited), intents: intents }), extra);
  }
  return Object.assign(reviewEnd(entry, "I3_RECEIPT", "IA_RECEIPT_REFUSED", why), extra);
};
const res = commitI3([{{node:code_node_IACentry.data}}][0], { price: [{{node:code_node_IACi3plan.data.price}}][0], outCount: [{{node:code_node_IACi3plan.data.outCount}}][0],
  outTotal: [{{node:code_node_IACi3plan.data.outTotal}}][0] }, [{{node:code_node_IACi3ans.data}}][0], list([{{node:sql_node_IACi3op2.data}}][0])[0]);
console.log("commit I3", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
