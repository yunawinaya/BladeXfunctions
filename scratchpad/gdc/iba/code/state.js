// INVENTORY_BULK_APPLY state: DONE -> replay its stored answer; REVIEW -> stop; intent rows -> resume; else fresh
const s = (v) => (v === undefined || v === null ? "" : String(v));
const rows = [{{node:sql_node_IBops.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
const mode = s([{{node:code_node_IBguard.data.mode}}][0]);
let done = null;
let review = null;
const intent = [];
let dbNow = "";
for (const r of list) {
  if (!r) continue;
  if (!dbNow && r.db_now) dbNow = s(r.db_now);
  const name = s(r.step_name);
  if (name === "IBA|DONE") done = r;
  else if (name === "IBA|REVIEW") review = r;
  else if (name.indexOf("IBA|I|") === 0) intent.push(r);
}
intent.sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1));
let route = "FRESH";
if (mode === "PLAN") route = "PLAN";
else if (done) route = "REPLAY";
else if (review) route = "REVIEW";
else if (intent.length) route = "RESUME";
let stored = {};
if (done) {
  try {
    stored = JSON.parse(s(done.result_ref) || "{}");
  } catch (e) {
    stored = {};
  }
}
return {
  route: route,
  dbNow: dbNow,
  intentText: intent.map((r) => s(r.result_ref)).join(""),
  intentParts: String(intent.length),
  storedResults: stored.results || [],
  storedSummary: stored.summary || {},
  reviewReason: review ? s(review.error_message) : "",
};
