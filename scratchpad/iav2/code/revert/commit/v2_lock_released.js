// IA_REVERT_V2_COMMIT - V2 release check: a COST row still held -> retry (it would block the item at the plant)
const commitV2LockReleased = function commitV2LockReleased(entry, rows) {
  const left = list(rows).filter((r) => digits(r.id)).map((r) => s(r.lock_key));
  if (left.length) return stepEnd(entry, "V2_COST", left.length + " COST lock(s) not given back (e.g. " + left.slice(0, 3).join(", ") + ")", false);
  return Object.assign({ route: "OK" }, END_EMPTY, { jobRows: [], needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_REVERT" });
};
const res = commitV2LockReleased([{{node:code_node_IVCentry.data}}][0], [{{node:sql_node_IVCv2finback.data}}][0]);
console.log("commit V2 lock released", JSON.stringify({ route: res.route, why: res.result_message }));
return res;
