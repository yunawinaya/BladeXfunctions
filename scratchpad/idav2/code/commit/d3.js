// IDA_V2_COMMIT - D3 RECEIPT: APPLY of op 2 (IDC|<job>|R). 200 (also REPLAYED) with EVERY R result "200" or "401" -> DONE + progress 80;
// a "401" skip (stock_control 0 after both PLANs) is tolerated as D2 tolerates op 1's: classic parity, the line's share is not received,
// the keys are named in the DONE ref and the job; any other R result -> REQUIRES_REVIEW IDA_RECEIPT_REFUSED; 409, no answer, a 400
// without a result_code -> wait 10 s (not counted) until 1,800 s after D3's FIRST transient answer (error_details.waitFrom, IA ruling 10
// R4; the runbook's reset clears it), then REQUIRES_REVIEW IDA_RECEIPT_TIMEOUT; a 400 with a result_code or a 500 -> REQUIRES_REVIEW
// IDA_RECEIPT_REFUSED. Never unlocks
const commitD3 = function commitD3(entry, plan, ans, ops) {
  const extra = { progressRows: [], needProgress: "NO", skipNote: "" };
  const code = s(ans.code);
  const rc = s(ans.result_code);
  const why = engineWhy("INVENTORY_BULK_APPLY (" + idaOpKey(entry.jobId, "R") + ")", ans);
  if (code === "200" && s(ans.allOk) === "YES") {
    const skipped = list(ans.skipped).map(s);
    const note = skipNoteOf(skipped, skipped.length);
    const ok = stepOk(entry, "D3_RECEIPT", JSON.stringify({ out_rows: num(plan.outCount), out_total: s(plan.outTotal), movements: num(plan.moveCount), result_code: rc, skipped: skipped.slice(0, 50),
      skipped_count: skipped.length }), (num(plan.moveCount) - skipped.length) + " recovered component(s) received (" + rc + ")" + note);
    return Object.assign(ok, { progressRows: [jobRow(entry, { progress_percent: 80, progress_message: (P80 + note).slice(0, 250) })], needProgress: "YES", skipNote: note });
  }
  if (code === "200") {
    return Object.assign(reviewEnd(entry, "D3_RECEIPT", "IDA_RECEIPT_REFUSED", why + "; " + s(ans.refusedKey) + " answered " + (s(ans.refusedCode) || "nothing") + (s(ans.refusedMessage) ? ": " + s(ans.refusedMessage) : ""),
      { refused: s(ans.refusedKey), code: s(ans.refusedCode) }), extra);
  }
  if (code === "409" || code === "" || (code === "400" && !rc)) {
    const intents = num((ops || {}).intents);
    const now = endNow(entry);
    let from = s(entry.waitFrom) || now;
    let waited = idaDbSeconds(from, now);
    if (!(waited >= 0)) {
      from = now;
      waited = 0;
    }
    if (waited > IDA_RECEIPT_WAIT_S) {
      return Object.assign(reviewEnd(entry, "D3_RECEIPT", "IDA_RECEIPT_TIMEOUT", "op 2 not applied " + Math.round(waited) + " s after its first transient answer (" + from + "): " + why,
        { waitFrom: from, waited: Math.round(waited), intents: intents, d2DoneAt: s(entry.d2DoneAt) }), extra);
    }
    return Object.assign(stepWait(entry, "D3_RECEIPT", why + (intents ? " (" + intents + " intent row(s))" : ""), IDA_RECEIPT_RETRY_S, { waitFrom: from, waited: Math.round(waited), intents: intents }), extra);
  }
  return Object.assign(reviewEnd(entry, "D3_RECEIPT", "IDA_RECEIPT_REFUSED", why), extra);
};
const res = commitD3([{{node:code_node_DCentry.data}}][0], { outCount: [{{node:code_node_DCd3plan.data.outCount}}][0], outTotal: [{{node:code_node_DCd3plan.data.outTotal}}][0],
  moveCount: [{{node:code_node_DCd3plan.data.moveCount}}][0] }, [{{node:code_node_DCd3ans.data}}][0], list([{{node:sql_node_DCd3ops.data}}][0])[0]);
console.log("commit D3", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
