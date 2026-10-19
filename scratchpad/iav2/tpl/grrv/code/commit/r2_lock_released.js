// GR_REVERT_COMMIT - R2 lock release check: no COST row of GRV|<job>|R2 left at token 0, else retry with backoff (the next run's
// release gives it back) - a lock never given back would hold every posting of the item at the plant
const commitR2LockReleased = function commitR2LockReleased(entry, rows) {
  const left = list(rows).filter((r) => digits(r.id)).map((r) => s(r.lock_key));
  if (left.length) return stepEnd(entry, "R2_COSTING", left.length + " COST lock(s) not given back (e.g. " + left.slice(0, 3).join(", ") + ")", false);
  return Object.assign({}, END, { route: "OK", needJobUpd: "NO", result_code: "", result_message: "", job_status: "COMMITTING_REVERT" });
};
const res = commitR2LockReleased([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr2finback.data}}][0]);
console.log("commit R2 lock released", JSON.stringify({ route: res.route, why: res.result_message }));
return res;
