// GD_ASYNC_SUBMIT - Same sales order guard (plan): the sales orders this save delivers, as a digits-only SQL filter on
// gd_async_job.source_so_ids (stored as a JSON list of the lines' so_id). Another unfinished save of one of them is read
// in parallel with this save's own job; the decision (busy or not) waits for the create-or-return route.
const soGuardPlan = function soGuardPlan(guard) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  let ids = [];
  try {
    ids = JSON.parse(s(guard.sourceSoIds) || "[]");
  } catch (e) {
    ids = [];
  }
  ids = (Array.isArray(ids) ? ids : []).map(s).filter((x) => /^[0-9]{1,20}$/.test(x));
  return {
    soCount: String(ids.length),
    soLikeSql: ids.length ? "(" + ids.map((x) => "j.source_so_ids LIKE '%\"" + x + "\"%'").join(" OR ") + ")" : "1 = 0",
  };
};
const res = soGuardPlan([{{node:code_node_EluyWNR5.data}}][0] || {});
console.log("submit same-SO plan", JSON.stringify({ sos: res.soCount }));
return res;
