// PUTAWAY_BULK_COMMIT - P4 plan: the receipt's putaway_status / gr_status recomputed by the lifted code_node_ds7jurnq on
// FRESH reads taken after P2 (this putaway's status, the other putaways of the receipt, its QI lots, putaway_setup's
// auto_completed_gr) - two putaways of one receipt finishing together still leave it right - and the putaway released
const commitP4Plan = function commitP4Plan(entry, grPartRows, S) {
  const base = { route: "GO", grRows: [], needGr: "NO", unlockRows: [{ id: entry.toId, is_processing: 0 }], needUnlock: "YES", grPutawayStatus: "", grStatus: "", jobRows: [],
    needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_PUTAWAY" };
  const g = joinChunks(grPartRows, entry.partPrefix + "GR|");
  if (!g) return Object.assign(base, stepEnd(entry, "P4_FINISH", "the receipt part of the prepared payload is missing", true), { unlockRows: [], needUnlock: "NO" });
  const A = pwAdapt(S);
  // sql_node_PCp4head returns plain columns (no j): reading r.j left to_status blank, so the receipt stayed "In Progress"
  const head = (list(S.hdr).map((r) => (r && r.j !== undefined ? (typeof r.j === "string" ? parseJ(r.j) : r.j) : r))[0]) || {};
  const out = __withContext({
    "workflowparams:allData": { id: entry.toId, gr_no: entry.grId },
    "node:code_node_KbJLkjP8": { data: { toStatus: s(head.to_status) } },
    "node:get_node_ca2032Ub": { data: A.setup },
    "node:search_node_SVMdNd3K": { data: A.others },
    "node:search_node_T5BGLPpK": { data: A.qi },
  }, () => __run("code_node_ds7jurnq"));
  const gr = A.gr || {};
  const want = { putaway_status: s(out.grPutawayStatus), gr_status: s(out.grStatus) };
  const same = s(gr.putaway_status) === want.putaway_status && s(gr.gr_status) === want.gr_status;
  return Object.assign(base, { grRows: same ? [] : [Object.assign({ id: s(gr.id) || entry.grId }, want)], needGr: same || !digits(s(gr.id) || entry.grId) ? "NO" : "YES",
    grPutawayStatus: want.putaway_status, grStatus: want.gr_status,
    result_message: "receipt " + entry.grId + " -> putaway " + want.putaway_status + " / " + want.gr_status + (same ? " (already)" : "") });
};
const S = { hdr: [{{node:sql_node_PCp4head.data}}][0], gr: [{{node:sql_node_PCp4gr.data}}][0], others: [{{node:sql_node_PCp4others.data}}][0], qi: [{{node:sql_node_PCp4qi.data}}][0],
  setup: [{{node:sql_node_PCp4setup.data}}][0] };
const res = commitP4Plan([{{node:code_node_PCentry.data}}][0], [{{node:sql_node_PCp4part.data}}][0], S);
console.log("commit P4 plan", JSON.stringify({ route: res.route, gr: res.needGr, status: [res.grPutawayStatus, res.grStatus], result: res.result_code, message: res.result_message }));
return res;
