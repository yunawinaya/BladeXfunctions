// Offline checks of the run-tail change: COMMIT code_node_KCp1after / KCp1plan on stand-in rows, and the browser's
// follow loop + general start (both form handlers) against a scripted worker with a fake clock.
// Usage: node scratchpad/pkg_tail/test/test_tail.js
const fs = require("fs");
const path = require("path");
const repo = path.resolve(__dirname, "..", "..", "..");
let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "\n     got  " + JSON.stringify(got) + "\n     want " + JSON.stringify(want)));
};
const find = (o, id) => {
  if (o && typeof o === "object") {
    if (o.id === id) return o;
    for (const v of Object.values(o)) {
      const r = find(v, id);
      if (r) return r;
    }
  }
  return null;
};

// ---- COMMIT
const commit = JSON.parse(fs.readFileSync(path.join(repo, "Packing/AsyncV2/PACKING_BULK_COMMIT.json"), "utf8"));
const runNode = (id, subs) => {
  let code = find(commit, id).data.script.code;
  for (const [k, v] of Object.entries(subs)) code = code.split("{{node:" + k + "}}").join(JSON.stringify(v));
  if (code.indexOf("{{node:") >= 0) throw new Error(id + ": unfilled placeholder " + code.slice(code.indexOf("{{node:"), code.indexOf("{{node:") + 60));
  return new Function("console", code)({ log() {} });
};
const entry = { jobId: "777", organizationId: "1", packingId: "9001", attempts: 0, rowVersion: 4, dbNow: "2026-10-26 12:00:00", jsAt: String(Date.now()), mytNow: "2026-10-26 20:00:00",
  phase: "A", steps: { P1_INVENTORY: { id: "55", status: "STARTED", attempt: 1, opId: "PKG|777|1" } } };
const plan = { opId: "PKG|777|1", attempt: 1 };
const after = (status, code) => [{ kind: "OP", operation_id: "PKG|777|1", operation_status: status, result_code: code, result_message: "" },
  { kind: "STEP", id: "55", operation_status: "STARTED", result_code: "1", operation_id: "PKG|777|1" }, { kind: "LOCK", operation_id: "PKGJOB-777" }];
const p1after = (status, code) => runNode("code_node_KCp1after", { "code_node_KCentry.data": entry, "code_node_KCp1plan.data": plan,
  "code_node_KCp1resp.data": { result_code: code }, "sql_node_KCp1after.data": after(status, code) });

let r = p1after("DONE", "OK");
const j = r.jobRows[0];
check("DONE after the call -> hand-over through the END branch", [r.route, r.action, r.result_code, r.job_status, r.needJobUpd, r.needStepAdd, r.needStepUpd, r.needUnlock],
  ["END", "HANDOVER", "PK_STOCK_MOVED", "COMMITTING_PACKING", "YES", "NO", "NO", "NO"]);
check("hand-over job row: due now, no lease, no error, row_version + 2", [j.id, j.job_status, j.next_attempt_at, j.lease_owner, j.lease_expires_at, j.row_version, j.attempt_count, j.error_code, j.finished_at],
  ["777", "COMMITTING_PACKING", "2026-10-26 12:00:00", null, null, 6, 0, null, null]);
r = p1after("DONE", "OK_REPLAYED");
check("OK_REPLAYED -> hand-over too", [r.route, r.action], ["END", "HANDOVER"]);
r = p1after("REJECTED", "LOCK_CONFLICT");
check("LOCK_CONFLICT -> retry unchanged", [r.route, r.action, r.result_code, r.needStepUpd, r.jobRows[0].attempt_count, r.jobRows[0].next_attempt_at],
  ["END", "RETRY", "PK_INVENTORY_RETRY", "YES", 1, "2026-10-26 12:00:02"]);
r = p1after("LOCKING", "");
check("operation still running -> wait unchanged", [r.route, r.action, r.result_code], ["END", "WAIT", "PK_INVENTORY_IN_PROGRESS"]);
r = p1after("REJECTED", "INSUFFICIENT_STOCK");
check("refusal -> clean FAILED unchanged", [r.route, r.action, r.job_status, r.needUnlock], ["END", "FAIL", "FAILED", "YES"]);

const entry2 = Object.assign({}, entry, { rowVersion: 6 });
r = runNode("code_node_KCp1plan", { "code_node_KCentry.data": entry2, "sql_node_KCp1data.data": [{ missing: "[]", lock_session: "PKGJOB-777" }],
  "sql_node_KCp1ops.data": [{ operation_id: "PKG|777|1", operation_status: "DONE", result_code: "OK" }] });
check("next run: the stored DONE operation -> CONTINUE, no second call", [r.route, r.hasMissing, r.needStepAdd], ["CONTINUE", "NO", "NO"]);

// ---- browser: fake clock + scripted answers
const harness = () => {
  const h = { start: 1793700000000, now: 1793700000000, timers: [], delays: [], calls: [], store: {}, messages: [], hidden: [] };
  h.setTimeout = (fn, ms) => {
    h.delays.push(ms);
    h.timers.push([h.now + ms, fn]);
  };
  h.Date = { now: () => h.now };
  h.window = { localStorage: { getItem: (k) => (k in h.store ? h.store[k] : null), setItem: (k, v) => (h.store[k] = String(v)) } };
  h.run = async () => {
    for (let i = 0; i < 20; i++) await null;
    while (h.timers.length) {
      h.timers.sort((a, b) => a[0] - b[0]);
      const [t, fn] = h.timers.shift();
      h.now = t;
      fn();
      for (let i = 0; i < 20; i++) await null;
    }
  };
  return h;
};
const WORKER = "2109924593737240578", SUBMIT = "2109924558618333185";
const scripted = (h, workerAnswers, statusAnswers) => (wf, params) => {
  h.calls.push([wf === WORKER ? "WORKER" : "SUBMIT", params.job_id || params.operation || "{}"]);
  const q = wf === WORKER ? workerAnswers : statusAnswers;
  return q.length > 1 ? q.shift() : q[0];
};

const saveSrc = fs.readFileSync(path.join(repo, "Packing/AsyncV2/pkgV2_onSave_Completed.js"), "utf8");
const saveFollow = saveSrc.slice(saveSrc.indexOf("const PKG_V2_OPEN"), saveSrc.indexOf("\nconst setFlag"));
const saveLoop = (h, answer) => new Function("pkgV2Call", "PKG_V2_WF", "window", "setTimeout", "Date", saveFollow + "\nreturn pkgV2FollowJob;")(
  (wf, params) => Promise.resolve({ ok: true, data: answer(wf, params) }), { SUBMIT: SUBMIT, WORKER: WORKER }, h.window, h.setTimeout, h.Date);

const mountSrc = fs.readFileSync(path.join(repo, "Packing/PackingOnMounted.js"), "utf8");
const mountBlock = mountSrc.slice(mountSrc.indexOf("const PKG_V2 = {"), mountSrc.indexOf("\n\n// Main execution function"));
const mounted = (h, answer, values) => {
  const form = {
    runWorkflow: (wf, params, ok) => ok({ data: answer(wf, params) }),
    getValue: (k) => (values || {})[k],
    getVarGlobal: () => "1",
    getVarSystem: () => "1",
    hide: (x) => h.hidden.push(x),
    $message: { warning: (m) => h.messages.push("warn: " + m), success: (m) => h.messages.push("ok: " + m), error: (m) => h.messages.push("err: " + m) },
  };
  return new Function("window", "setTimeout", "Date", mountBlock + "\nreturn { pkgV2FollowJob, pkgV2Drain, pkgV2ShowJobState };").call(form, h.window, h.setTimeout, h.Date);
};
const open = (st, extra) => Object.assign({ worker_route: "WORKED", processed: "1", job_id: "J", job_status: st, result_code: "", result_message: "", jobs: '[{"attempt_count":"0"}]' }, extra || {});
const idle = { worker_route: "IDLE", processed: "0", job_id: "", job_status: "", result_code: "", result_message: "", jobs: "[]" };

(async () => {
  for (const [label, make] of [["save", (h, a) => saveLoop(h, a)], ["mounted", (h, a) => mounted(h, a).pkgV2FollowJob]]) {
    let h = harness();
    let ended = [];
    make(h, scripted(h, [open("COMMITTING_PACKING", { result_code: "PK_STOCK_MOVED" }), open("COMPLETED")], [{}]))("J", "9001", "1", (st, m) => ended.push(st));
    await h.run();
    check(label + ": hand-over -> second start 1.5 s later -> COMPLETED", [h.delays, ended, h.calls.length], [[1500], ["COMPLETED"], 2]);

    h = harness();
    ended = [];
    make(h, scripted(h, [open("COMMITTING_PACKING", { result_code: "PK_INVENTORY_RETRY", jobs: '[{"attempt_count":"1"}]' }), idle, open("COMPLETED")],
      [{ job_id: "J", job_status: "COMMITTING_PACKING" }]))("J", "9001", "1", (st) => ended.push(st));
    await h.run();
    check(label + ": lock retry waits the backoff; not due yet -> STATUS -> wait -> COMPLETED", [h.delays, ended, h.calls.map((c) => c[0])],
      [[2500, 3000], ["COMPLETED"], ["WORKER", "WORKER", "SUBMIT", "WORKER"]]);

    h = harness();
    ended = [];
    make(h, scripted(h, [open("COMMITTING_PACKING", { result_code: "PK_INVENTORY_IN_PROGRESS" }), open("COMPLETED")], [{}]))("J", "9001", "1", (st) => ended.push(st));
    await h.run();
    check(label + ": operation still running -> 10 s", [h.delays, ended], [[10000], ["COMPLETED"]]);

    h = harness();
    ended = [];
    make(h, scripted(h, [open("FAILED", { result_message: "the stock stayed busy" })], [{}]))("J", "9001", "1", (st, m) => ended.push(st + ": " + m));
    await h.run();
    check(label + ": FAILED ends at once with its message", [h.delays, ended], [[], ["FAILED: the stock stayed busy"]]);

    h = harness();
    ended = [];
    const follow = make(h, scripted(h, [open("COMMITTING_PACKING"), open("COMPLETED")], [{}]));
    follow("J", "9001", "1", (st) => ended.push(st));
    follow("J", "9001", "1", (st) => ended.push("second " + st));
    await h.run();
    check(label + ": one follower per job", [ended, h.calls.length], [["COMPLETED"], 2]);

    h = harness();
    ended = [];
    make(h, scripted(h, [idle], [{ job_id: "J", job_status: "COMMITTING_PACKING" }]))("J", "9001", "1", (st) => ended.push(st));
    await h.run();
    check(label + ": gives up after 10 minutes, no end reported", [ended.length, h.now - h.start >= 600000, h.now - h.start < 700000, h.calls.length < 60], [0, true, true, true]);
  }

  // mounted: open with no job of its own -> one general start per 2 minutes
  let h = harness();
  let m = mounted(h, scripted(h, [idle], [{ job_id: "" }]), { id: "9001", organization_id: "1" });
  await m.pkgV2ShowJobState();
  await m.pkgV2ShowJobState();
  h.now = h.start + 121000;
  await m.pkgV2ShowJobState();
  await h.run();
  check("mounted: no job -> worker {} at most every 2 minutes", h.calls.filter((c) => c[0] === "WORKER").map((c) => c[1]), ["{}", "{}"]);

  // mounted: an open job -> buttons hidden, followed to COMPLETED, no general start
  h = harness();
  m = mounted(h, scripted(h, [open("COMPLETED")], [{ job_id: "J", job_status: "COMMITTING_PACKING", result_message: "" }]), { id: "9001", organization_id: "1" });
  await m.pkgV2ShowJobState();
  await h.run();
  check("mounted: open job -> hidden buttons + follow -> completed message", [h.hidden.length, h.calls.map((c) => c.join(" ")), h.messages.map((x) => x.slice(0, 4))],
    [1, ["SUBMIT STATUS", "WORKER J"], ["warn", "ok: "]]);

  // mounted: a FAILED job is reported once, and the open also starts the worker {}
  h = harness();
  m = mounted(h, scripted(h, [idle], [{ job_id: "J2", job_status: "FAILED", result_message: "the stock stayed busy" }]), { id: "9001", organization_id: "1" });
  await m.pkgV2ShowJobState();
  await m.pkgV2ShowJobState();
  await h.run();
  check("mounted: FAILED reported once + general start", [h.messages, h.calls.filter((c) => c[0] === "WORKER").map((c) => c[1])],
    [["err: The last completion was not saved: the stock stayed busy"], ["{}"]]);

  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
