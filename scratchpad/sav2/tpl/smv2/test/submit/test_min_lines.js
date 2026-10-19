// node test/submit/test_min_lines.js - min_lines on the BUILT LOT_V2_SUBMIT (its guard, entry and entry-answer code nodes run
// through lib/harness.js): a CANCEL of <= min_lines stored flat lines answers NOT_ELIGIBLE "classic" before any write; absent /
// invalid min_lines, more lines, other actions, BUSY / STALE and STATUS are unchanged.
const fs = require("fs");
const path = require("path");
const H = require(path.join(__dirname, "..", "..", "lib", "harness.js"));
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "Stock Movement", "Location Transfer", "AsyncV2", "LOT_V2_SUBMIT.json"), "utf8"));
const nodes = {};
const walk = (n) => {
  if (Array.isArray(n)) n.forEach(walk);
  else if (n && typeof n === "object") {
    if (typeof n.id === "string" && n.type) nodes[n.id] = n;
    Object.values(n).forEach(walk);
  }
};
walk(doc);
const body = (id) => nodes[id].data.script.code;
H.truthy("request declares min_lines", doc.request_json.some((r) => r.name === "min_lines"));

const LOT = "2105231525751984129";
const facts = (o) => Object.assign({ db_now: "2026-10-16 10:00:00", key_job: null, key_lot: null, lot_id: LOT, stock_movement_no: "LOT-1", stock_movement_status: "In Progress",
  organization_id: "9", plant_id: "8", no_type: "1", movement_type: "Location Transfer", issue_date: "2026-10-16 00:00:00", is_production_order: 0, line_count: 50,
  last_lock: "LOCK|2", open_jobs: null, last_job: null, lot_v2_job_id: null, link_job: null, issued_reuse: 0 }, o || {});
const run = (o) => {
  const p = Object.assign({ operation: "SUBMIT", saveAs: "Cancelled", pageStatus: "Edit", lot_id: LOT, idempotency_key: "LOT:9:" + LOT + ":abc12345", source: "LIST",
    min_lines: "50", formStatus: "In Progress", facts: facts() }, o);
  const guard = H.runBody(body("code_node_LSguard"), { "workflowparams:operation": p.operation, "workflowparams:saveAs": p.saveAs, "workflowparams:pageStatus": p.pageStatus,
    "workflowparams:lot_id": p.lot_id, "workflowparams:idempotency_key": p.idempotency_key, "workflowparams:source": p.source, "system:tenantId": "1",
    "system:uid": "7", "system:uuid": "0a1b2c3d-x" }, "guard");
  const entry = H.runBody(body("code_node_LSentry"), { "node:code_node_LSguard.data": guard, "node:sql_node_LSfacts.data": [p.facts],
    "workflowparams:form.stock_movement_status": p.formStatus, "workflowparams:min_lines": p.min_lines }, "entry");
  const ans = H.runBody(body("code_node_LSansres"), { "node:code_node_LSguard.data": guard, "node:code_node_LSentry.data": entry }, "answer");
  return { guard, entry, ans };
};
const pick = (r) => ({ route: r.entry.route, action: r.entry.action, reason: r.entry.reason });

let r = run({});
H.eq("50 stored lines, min_lines 50 -> NOT_ELIGIBLE classic", pick(r), { route: "NOT_ELIGIBLE", action: "CANCEL", reason: "classic" });
H.eq("  its answer", { route: r.ans.route, code: r.ans.code, reason: r.ans.reason, error_code: r.ans.error_code, line_count: r.ans.line_count, job_id: r.ans.job_id },
  { route: "NOT_ELIGIBLE", code: "300", reason: "classic", error_code: "LOT_NOT_ELIGIBLE", line_count: "50", job_id: "" });
H.eq("51 stored lines, min_lines 50 -> CANCEL goes on", pick(run({ facts: facts({ line_count: 51 }) })), { route: "GO", action: "CANCEL", reason: "" });
H.eq("0 stored lines, min_lines 50 -> NOT_ELIGIBLE", pick(run({ facts: facts({ line_count: 0 }) })).route, "NOT_ELIGIBLE");
H.eq("min_lines absent -> CANCEL goes on", pick(run({ min_lines: undefined, facts: facts({ line_count: 10 }) })).route, "GO");
H.eq("min_lines absent, 0 lines -> CANCEL goes on", pick(run({ min_lines: undefined, facts: facts({ line_count: 0 }) })).route, "GO");
H.eq("min_lines null -> CANCEL goes on", pick(run({ min_lines: null, facts: facts({ line_count: 10 }) })).route, "GO");
H.eq("min_lines 'abc' -> 0 -> CANCEL goes on", pick(run({ min_lines: "abc", facts: facts({ line_count: 10 }) })).route, "GO");
H.eq("min_lines as a number 50 -> NOT_ELIGIBLE", pick(run({ min_lines: 50, facts: facts({ line_count: 10 }) })).route, "NOT_ELIGIBLE");
H.eq("min_lines 1000, 600 lines -> CANCEL goes on (the classic takes <= 500)", pick(run({ min_lines: "1000", facts: facts({ line_count: 600 }) })).route, "GO");
H.eq("EDIT with min_lines 50, 10 lines -> unchanged", pick(run({ saveAs: "In Progress", facts: facts({ line_count: 10 }) })), { route: "GO", action: "EDIT", reason: "" });
H.eq("COMPLETE with min_lines 50, 10 lines -> unchanged", pick(run({ saveAs: "Completed", facts: facts({ line_count: 10 }) })), { route: "GO", action: "COMPLETE", reason: "" });
H.eq("Processing + small cancel -> BUSY first", pick(run({ facts: facts({ stock_movement_status: "Processing", line_count: 10 }) })).route, "BUSY");
H.eq("Draft + cancel -> STOP not cancellable", run({ formStatus: "Draft", facts: facts({ stock_movement_status: "Draft", line_count: 10 }) }).entry.errorCode, "LOT_NOT_CANCELLABLE");
H.eq("stale list row -> STALE", pick(run({ formStatus: "Draft", facts: facts({ line_count: 10 }) })).route, "STALE");
H.eq("this key already has a job -> its STATUS", pick(run({ facts: facts({ line_count: 10, key_job: JSON.stringify({ id: "5", job_status: "QUEUED",
  correlation_id: "LOT|" + LOT, progress_percent: 0, progress_message: "Queued for processing" }) }) })).route, "STATUS");
H.done();
