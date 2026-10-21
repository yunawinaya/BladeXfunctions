// IA_REVERT_V2_COMMIT - V4 check: the IA reads back at the HDR part's after-values (Draft, posted_status blank) -> DONE
const commitV4Check = function commitV4Check(entry, after, iaRowsNow) {
  const ia = list(iaRowsNow)[0] || {};
  const a = after && typeof after === "object" ? after : {};
  const ok = s(ia.item_assembly_status) === "Draft" && Object.keys(a).every((c) => iaSameVal(a[c], ia[c]));
  if (!ok) return stepEnd(entry, "V4_FINISH", "the Item Assembly reads back " + (s(ia.item_assembly_status) || "nothing") + " / posted '" + s(ia.posted_status) + "' after the write", false);
  return stepOk(entry, "V4_FINISH", "Draft", "the Item Assembly is Draft");
};
const res = commitV4Check([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCv4plan.data.after}}][0], [{{node:sql_node_IVCv4back.data}}][0]);
console.log("commit V4 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
