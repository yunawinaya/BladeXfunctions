// INVENTORY_BULK_APPLY state: DONE -> replay its stored answer; REVIEW -> stop; intent rows -> resume; else fresh. Run marker
// IBA|RUN|nnn (heartbeat in finished_at): the latest generation RUNNING with a heartbeat under 20 min = another call of this operation
// is alive -> BUSY; else this APPLY call takes the next generation (CLAIM); PLAN and REVIEW write nothing (SKIP)
const s = (v) => (v === undefined || v === null ? "" : String(v));
const RUN_STALE_S = 1200;
const rows = [{{node:sql_node_IBops.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
const mode = s([{{node:code_node_IBguard.data.mode}}][0]);
let done = null;
let review = null;
let mark = null;
const intent = [];
let dbNow = "";
for (const r of list) {
  if (!r) continue;
  if (!dbNow && r.db_now) dbNow = s(r.db_now);
  const name = s(r.step_name);
  if (name === "IBA|DONE") done = r;
  else if (name === "IBA|REVIEW") review = r;
  else if (name.indexOf("IBA|I|") === 0) intent.push(r);
  else if (name.indexOf("IBA|RUN|") === 0) {
    const g = parseInt(name.slice(8), 10) || 0;
    if (!mark || g > mark.gen) mark = { gen: g, status: s(r.step_status), hb: s(r.heartbeat) };
  }
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
const at = (v) => Date.parse(s(v).replace(" ", "T"));
const age = mark && mark.hb && dbNow ? (at(dbNow) - at(mark.hb)) / 1000 : Infinity;
const live = !!mark && mark.status === "RUNNING" && age < RUN_STALE_S;
const runGate = mode !== "APPLY" || route === "REVIEW" ? "SKIP" : live ? "BUSY" : "CLAIM";
const gen = (mark ? mark.gen : 0) + 1;
return {
  route: route,
  dbNow: dbNow,
  intentText: intent.map((r) => s(r.result_ref)).join(""),
  intentParts: String(intent.length),
  storedResults: stored.results || [],
  storedSummary: stored.summary || {},
  reviewReason: review ? s(review.error_message) : "",
  runGate: runGate,
  runGen: String(gen),
  runStep: "IBA|RUN|" + String(gen).padStart(3, "0"),
  runMessage: live ? "the same operation is still running (run " + mark.gen + ", last heartbeat " + mark.hb + "); try again later" : "",
};
