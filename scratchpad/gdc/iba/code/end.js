// INVENTORY_BULK_APPLY end: the answer of this run, and whether the locks go back (kept on REVIEW, as INVENTORY_APPLY_OPERATION does)
const s = (v) => (v === undefined || v === null ? "" : String(v));
const mode = s([{{node:code_node_IBguard.data.mode}}][0]);
const plan = [{{node:code_node_IBplan.data}}][0] || {};
const verify = [{{node:code_node_IBverify.data}}][0] || {};
const route = s(plan.route);
let out;
if (route === "WRITE") {
  out = s(verify.route) === "DONE"
    ? { code: "200", result_code: "OK", message: "Applied " + ((plan.summary || {}).movements || 0) + " movements", release: "YES" }
    : { code: "500", result_code: "REQUIRES_REVIEW", message: s(verify.problems), release: "NO" };
} else if (route === "FAIL") {
  out = { code: "400", result_code: s(plan.result_code), message: s(plan.result_message), release: "YES" };
} else if (route === "LOST") {
  out = { code: "409", result_code: "LOCK_BUSY", message: s(plan.result_message), release: "YES" };
} else {
  out = { code: "500", result_code: "REQUIRES_REVIEW", message: s(plan.result_message), release: "NO" };
}
if (mode !== "APPLY") out.release = "NO";
return Object.assign(out, { results: plan.results || [], summary: plan.summary || {} });
