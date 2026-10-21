// GR_REVERT_COMMIT - R5 plan: the receipt back to Created (update_node_grRvGr's write: gr_status, previous_status Created,
// putaway_status blank); its Processing lock ends with it
const commitR5Plan = function commitR5Plan(entry, grRows) {
  const g = list(grRows)[0] || null;
  const base = { route: "GO", headerRows: [], needHeader: "NO", jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_REVERT" };
  if (!g) return Object.assign(base, stepEnd(entry, "R5_FINISH", "the Goods Receiving cannot be read", false));
  if (s(g.gr_status) === "Created") return Object.assign(base, { result_message: "the receipt is already Created" });
  if (s(g.gr_status) !== "Processing") return Object.assign(base, stepEnd(entry, "R5_FINISH", "the Goods Receiving is " + s(g.gr_status) + ", not Processing under this revert", true));
  return Object.assign(base, { headerRows: [{ id: entry.grId, gr_status: "Created", previous_status: "Created", putaway_status: "" }], needHeader: "YES", result_message: "the receipt back to Created" });
};
const res = commitR5Plan([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr5gr.data}}][0]);
console.log("commit R5 plan", JSON.stringify({ route: res.route, header: res.needHeader, result: res.result_code, message: res.result_message }));
return res;
