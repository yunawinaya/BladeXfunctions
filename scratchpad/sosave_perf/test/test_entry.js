// code_node_SSentry, v6 (base) against the build (out), over the same scenarios: only a small, unheld SUBMIT may change,
// from GO to NOT_ELIGIBLE / SOV2_SMALL. Synthetic fixtures in the shapes of the recorded prod run (10-27).
//   node scratchpad/sosave_perf/test/test_entry.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const codeOf = (file) => {
  const wf = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  const find = (ns) => {
    for (const n of ns) {
      if (n.id === "code_node_SSentry") return n;
      const hit = find(n.blocks || []);
      if (hit) return hit;
    }
    return null;
  };
  return find(wf.nodes).data.script.code;
};
const run = (code, guard, facts) => {
  const src = code
    .split("{{node:code_node_SSguard.data}}").join(JSON.stringify(guard))
    .split("{{node:sql_node_SSfacts.data}}").join(JSON.stringify(facts));
  const log = console.log;
  console.log = () => {};
  try {
    return new Function(src)();
  } finally {
    console.log = log;
  }
};

const OLD = codeOf("base/SO_SAVE_SUBMIT.v6.json");
const NEW = codeOf("out/SO_SAVE_SUBMIT.json");

const guard = (o) => Object.assign({ route: "FACTS", code: "", message: "", reason: "", operation: "SUBMIT", tenantId: "012345", uid: "1", nonce: "abc123",
  soId: "2114911844400365553", soNo: "SO-T-1", jobIdSql: "0", isEdit: "YES", isIssue: "YES", saveAs: "Issued", pageStatus: "Edit", previousStatus: "Issued",
  organizationId: "2079475909219319795", plantId: "2079475909219319795", payloadHash: "h", lineCount: 3, partRows: [], partCount: 2, needCl: "YES",
  token: "", answers: {} }, o);
const facts = (o) => [Object.assign({ db_now: "2026-10-27 02:47:41", so_id: "2114911844400365553", so_no: "SO-T-1", so_status: "Issued", is_processing: "0",
  last_lock: "LOCK|1", gd_processing: "0", gd_create_jobs: "0", live_pp: "0" }, o)];
const job = (status, extra) => JSON.stringify(Object.assign({ id: "2114911889589796850", job_status: status, progress_percent: 0, progress_message: "x",
  confirmation_token: "tok", correlation_id: "SO|2114911844400365553", request_payload: "{}", row_version: 1 }, extra || {}));

const S = [
  // name, guard, facts, expected old route, expected new route (and new message)
  ["edit 3 lines", guard(), facts(), "GO", "NOT_ELIGIBLE", "SOV2_SMALL"],
  ["edit 100 lines (boundary)", guard({ lineCount: 100 }), facts(), "GO", "NOT_ELIGIBLE", "SOV2_SMALL"],
  ["edit 101 lines", guard({ lineCount: 101 }), facts(), "GO", "GO"],
  ["edit 2,000 lines", guard({ lineCount: 2000 }), facts(), "GO", "GO"],
  ["edit 3 lines, line count as text", guard({ lineCount: "3" }), facts(), "GO", "NOT_ELIGIBLE", "SOV2_SMALL"],
  ["add 3 lines", guard({ isEdit: "NO", soId: "0", pageStatus: "Add", previousStatus: "" }), [{ db_now: "2026-10-27 02:47:41" }], "GO", "NOT_ELIGIBLE", "SOV2_SMALL"],
  ["clone 1 line (Draft)", guard({ isEdit: "NO", soId: "0", pageStatus: "Clone", isIssue: "NO", saveAs: "Draft", lineCount: 1 }), [{ db_now: "2026-10-27 02:47:41" }], "GO", "NOT_ELIGIBLE", "SOV2_SMALL"],
  ["add 500 lines", guard({ isEdit: "NO", soId: "0", pageStatus: "Add", lineCount: 500 }), [{ db_now: "2026-10-27 02:47:41" }], "GO", "GO"],
  ["edit 3 lines, SO held (is_processing)", guard(), facts({ is_processing: "1" }), "BUSY", "BUSY"],
  ["edit 3 lines, an open SAVE_SO job", guard(), facts({ open_jobs: JSON.stringify([{ id: "9", job_status: "QUEUED" }]) }), "BUSY", "BUSY"],
  ["edit 3 lines, a job under review", guard(), facts({ open_jobs: JSON.stringify([{ id: "9", job_status: "REQUIRES_REVIEW" }]) }), "BUSY", "BUSY"],
  ["edit 3 lines, a GD in Processing", guard(), facts({ gd_processing: "1" }), "BUSY", "BUSY"],
  ["edit 3 lines, a GD create job", guard(), facts({ gd_create_jobs: "1" }), "BUSY", "BUSY"],
  ["edit 3 lines, a live Picking Plan", guard(), facts({ live_pp: "1" }), "NOT_ELIGIBLE", "NOT_ELIGIBLE", "SOV2_PICKING_PLAN"],
  ["edit 3 lines, Draft GD / SI (404)", guard(), facts({ draft_gd_nos: "GD-1" }), "ANSWER", "ANSWER"],
  ["edit 3 lines, the same request queued", guard(), facts({ same_job: job("QUEUED") }), "EXISTING", "EXISTING"],
  ["edit, SO not found", guard(), [{ db_now: "2026-10-27 02:47:41" }], "STOP", "STOP"],
  ["STATUS", guard({ operation: "STATUS" }), facts({ the_job: job("PREPARING") }), "STATUS", "STATUS"],
  ["CONFIRM, right token", guard({ operation: "CONFIRM", token: "tok" }), facts({ the_job: job("AWAITING_CONFIRMATION") }), "CONFIRM", "CONFIRM"],
  ["CONFIRM, wrong token", guard({ operation: "CONFIRM", token: "zzz" }), facts({ the_job: job("AWAITING_CONFIRMATION") }), "STOP", "STOP"],
];

let fail = 0;
for (const [name, g, f, oldRoute, newRoute, newMsg] of S) {
  const o = run(OLD, g, f);
  const n = run(NEW, g, f);
  const problems = [];
  if (o.route !== oldRoute) problems.push(`old route ${o.route}, expected ${oldRoute}`);
  if (n.route !== newRoute) problems.push(`new route ${n.route}, expected ${newRoute}`);
  if (newMsg && n.message !== newMsg) problems.push(`new message ${n.message}, expected ${newMsg}`);
  // every case that is not the small route must answer exactly as v6 did, key for key
  const small = newMsg === "SOV2_SMALL";
  if (!small && JSON.stringify(o) !== JSON.stringify(n)) problems.push("answer differs from v6");
  if (small && (n.code !== "300" || o.route !== "GO")) problems.push(`small route code ${n.code} / old ${o.route}`);
  // the node's declared outputs: no new keys
  const extra = Object.keys(n).filter((k) => !(k in o));
  if (extra.length) problems.push(`new keys ${extra}`);
  console.log(`${problems.length ? "FAIL" : "ok  "} ${name.padEnd(42)} v6 ${o.route.padEnd(12)} -> ${n.route.padEnd(12)} ${n.message === "SOV2_SMALL" ? n.reason : ""}${problems.length ? "  " + problems.join("; ") : ""}`);
  if (problems.length) fail++;
}
console.log(fail ? `${fail} FAILED` : `all ${S.length} passed`);
process.exit(fail ? 1 : 0);
