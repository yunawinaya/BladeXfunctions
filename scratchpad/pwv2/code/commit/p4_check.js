// PUTAWAY_BULK_COMMIT - P4 check: the receipt at the recomputed status, the putaway released -> DONE
const commitP4Check = function commitP4Check(entry, plan, grRows, toRows) {
  const gr = (list(grRows).map((r) => (typeof r.j === "string" ? parseJ(r.j) : r.j))[0]) || {};
  const to = list(toRows)[0] || {};
  if (s(gr.putaway_status) !== s(plan.grPutawayStatus) || s(gr.gr_status) !== s(plan.grStatus)) {
    return stepEnd(entry, "P4_FINISH", "the receipt reads back as " + s(gr.putaway_status) + " / " + s(gr.gr_status) + ", not " + s(plan.grPutawayStatus) + " / " + s(plan.grStatus), false);
  }
  if (String(to.is_processing) !== "0") return stepEnd(entry, "P4_FINISH", "the putaway is still locked after the release", false);
  return stepOk(entry, "P4_FINISH", s(gr.putaway_status) + " / " + s(gr.gr_status), "receipt " + s(gr.putaway_status));
};
const res = commitP4Check([{{node:code_node_PCentry.data}}][0], [{{node:code_node_PCp4plan.data}}][0], [{{node:sql_node_PCp4grB.data}}][0], [{{node:sql_node_PCp4headB.data}}][0]);
console.log("commit P4 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
