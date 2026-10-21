// GR_REVERT_COMMIT - R5 check: the receipt reads back Created -> DONE
const commitR5Check = function commitR5Check(entry, grRows) {
  const g = list(grRows)[0] || {};
  if (s(g.gr_status) !== "Created") return stepEnd(entry, "R5_FINISH", "the Goods Receiving reads back " + (s(g.gr_status) || "nothing") + " after the write", false);
  return stepOk(entry, "R5_FINISH", "Created", "the receipt is Created");
};
const res = commitR5Check([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr5back.data}}][0]);
console.log("commit R5 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
