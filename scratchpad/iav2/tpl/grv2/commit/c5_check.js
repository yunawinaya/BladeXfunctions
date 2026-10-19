// GR_COMPLETE_COMMIT - C5 check: the receipt reads back at its final status -> DONE
const commitC5Check = function commitC5Check(entry, plan, grRows) {
  const want = list(plan.headerRows)[0] || {};
  const gr = list(grRows)[0] || {};
  if (s(gr.gr_status) !== s(want.gr_status) || s(gr.putaway_status) !== s(want.putaway_status)) {
    return stepEnd(entry, "C5_FINISH", "the Goods Receiving reads back as " + s(gr.gr_status) + " / " + s(gr.putaway_status) + ", not " + s(want.gr_status) + " / " + s(want.putaway_status), false);
  }
  return stepOk(entry, "C5_FINISH", s(gr.gr_status) + " / " + s(gr.putaway_status), "receipt " + s(gr.gr_status));
};
const res = commitC5Check([{{node:code_node_RCentry.data}}][0], [{{node:code_node_RCc5plan.data}}][0], [{{node:sql_node_RCc5back.data}}][0]);
console.log("commit C5 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
