// test_submit_so_guard.js <request.json>: GD_ASYNC_SUBMIT's same sales order guard. Unit checks of the two new code nodes,
// then the patched workflow on the interpreter (repo Goods Delivery/AsyncV2/, every read mocked, writes recorded): a new
// save is queued when no other save delivers its order, refused while one does (running / under review), a resubmission of
// the same save is answered as before, and a confirmation is refused too. Nothing touches a database.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const REQ = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const node = (file, subs) => {
  let src = fs.readFileSync(__dirname + "/../code/" + file, "utf8");
  for (const [k, v] of Object.entries(subs)) src = src.split("{{" + k + "}}").join(JSON.stringify(v));
  return Function(src)();
};
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };

t("plan: digits-only LIKE filter of the sales orders; nothing usable = matches nothing", () => {
  let r = node("so_plan.js", { "node:code_node_EluyWNR5.data": { sourceSoIds: '["111","222"]' } });
  assert.strictEqual(r.soLikeSql, "(j.source_so_ids LIKE '%\"111\"%' OR j.source_so_ids LIKE '%\"222\"%')");
  assert.strictEqual(r.soCount, "2");
  assert.strictEqual(node("so_plan.js", { "node:code_node_EluyWNR5.data": { sourceSoIds: "[]" } }).soLikeSql, "1 = 0");
  assert.strictEqual(node("so_plan.js", { "node:code_node_EluyWNR5.data": { sourceSoIds: "not json" } }).soLikeSql, "1 = 0");
  r = node("so_plan.js", { "node:code_node_EluyWNR5.data": { sourceSoIds: JSON.stringify(["1' OR '1'='1", "333"]) } });
  assert.strictEqual(r.soLikeSql, "(j.source_so_ids LIKE '%\"333\"%')", "a non-digit id never reaches the SQL");
});

t("decision: only CREATE / CONFIRM with another unfinished save are refused", () => {
  const g = { idempotencyKey: "K1", payloadHash: "H1" };
  const row = { job_id: "9", job_status: "VALIDATING", source_so_no: "SO/1" };
  const d = (route, rows) => node("so_busy.js", { "node:code_node_EluyWNR5.data": g, "node:code_node_iJTFTwP3.data": { route }, "node:sql_node_GSsoBusy.data": rows });
  assert.strictEqual(d("CREATE", [row]).route, "BUSY");
  assert.strictEqual(d("CREATE", [row]).result_code, "GD_SO_SAVE_RUNNING");
  assert.ok(/SO\/1 is still being saved in the background \(job 9, VALIDATING\)/.test(d("CREATE", [row]).result_message));
  assert.strictEqual(d("CONFIRM", row).route, "BUSY", "a count=1 read arrives as one object");
  assert.strictEqual(d("RETURN", [row]).route, "GO");
  assert.strictEqual(d("REJECT", [row]).route, "GO");
  assert.strictEqual(d("CREATE", []).route, "GO");
  assert.strictEqual(d("CREATE", null).route, "GO");
  const rv = d("CREATE", [{ job_id: "8", job_status: "REQUIRES_REVIEW", source_so_no: "SO/2" }]);
  assert.strictEqual(rv.result_code, "GD_SO_SAVE_REVIEW");
  assert.ok(/under review \(job 8\): please contact support/.test(rv.result_message));
  assert.strictEqual(d("CREATE", [row]).idempotency_key, "K1");
});

// the patched workflow on the interpreter
const run = (existing, others, confirmationHash) => {
  const writes = [];
  let soSql = "";
  const e = new Engine({
    dir: R + "Goods Delivery/AsyncV2",
    db: { tenantId: "711077", insert: (tb, rows) => { writes.push("insert " + tb); return rows.map((r, i) => Object.assign({ id: String(7000 + i) }, r)); }, update: (tb, rows) => { writes.push("update " + tb); return rows.length; } },
    mocks: {
      sql: {
        sql_node_GZBo7WZi: () => [Object.assign({ db_now: "2026-10-19 10:00:00" }, existing || {})],
        sql_node_GSsoBusy: (text) => { soSql = text; return others || []; },
        sql_node_GSfit: () => [],
        sql_node_mhbRT14u: () => [{ id: existing ? existing.id : "7000", job_status: existing ? existing.job_status : "QUEUED", idempotency_key: REQ.idempotency_key, payload_hash: existing ? existing.payload_hash : "", gd_id: "", gd_no: "", is_deleted: 0, row_version: 0, progress_message: "" }],
      },
      read: {},
    },
  });
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  const params = Object.assign({}, REQ, confirmationHash ? { confirmation_hash: confirmationHash } : {});
  const r = e.run("GD_ASYNC_SUBMIT", params);
  return { out: r.returned || {}, writes, soSql, trace: e.trace };
};
const SO = JSON.parse(REQ.payload).lines[0].line_so_id;
const other = { job_id: "2111000000000000001", job_status: "READY_TO_COMMIT", source_so_no: "SO/20261016-035" };

t("workflow: no other save of the order -> queued (one insert), and the read asked for exactly this order", () => {
  const r = run(null, []);
  assert.strictEqual(r.out.result_code, "", JSON.stringify(r.out));
  assert.deepStrictEqual(r.writes, ["insert GD Async Job"]);
  assert.ok(r.soSql.includes("j.source_so_ids LIKE '%\"" + SO + "\"%'"), r.soSql);
  assert.ok(r.soSql.includes("j.idempotency_key <> '" + REQ.idempotency_key + "'"));
});
t("workflow: another unfinished save of the order -> refused GD_SO_SAVE_RUNNING, nothing written", () => {
  const r = run(null, [other]);
  assert.strictEqual(r.out.result_code, "GD_SO_SAVE_RUNNING");
  assert.strictEqual(r.out.job_id, "");
  assert.deepStrictEqual(r.writes, []);
});
// the payload hash SUBMIT computes for this request: an existing job of the same save carries it
const HASH = run({ id: "1", idempotency_key: REQ.idempotency_key, job_status: "QUEUED", payload_hash: "other", is_deleted: 0 }, []).out.payload_hash;
assert.ok(/^[0-9a-f]{64}$/.test(HASH), "the computed payload hash (a KEY_REUSED answer echoes it): " + HASH);
t("workflow: the same save resubmitted (same key) takes the RETURN route and is answered as before, not refused", () => {
  const r = run({ id: "7001", idempotency_key: REQ.idempotency_key, job_status: "VALIDATING", payload_hash: HASH, confirmation_hash: "", is_deleted: 0, row_version: 1 }, [other]);
  assert.ok(r.trace.some((x) => /code_node_iJTFTwP3/.test(x)), "the decide node ran");
  assert.strictEqual(r.out.result_code, "", JSON.stringify(r.out));
  assert.strictEqual(r.out.job_id, "7001");
  assert.deepStrictEqual(r.writes, []);
});
t("workflow: a confirmation (CONFIRM) while another save delivers the order -> refused, the job is not made due", () => {
  const waiting = { id: "7002", idempotency_key: REQ.idempotency_key, job_status: "AWAITING_CONFIRMATION", payload_hash: HASH, confirmation_hash: "", is_deleted: 0, row_version: 2 };
  const busy = run(waiting, [other], "c".repeat(64));
  assert.strictEqual(busy.out.result_code, "GD_SO_SAVE_RUNNING", JSON.stringify(busy.out));
  assert.deepStrictEqual(busy.writes, []);
  const free = run(waiting, [], "c".repeat(64));
  assert.strictEqual(free.out.result_code, "", JSON.stringify(free.out));
  assert.deepStrictEqual(free.writes, ["update GD Async Job"]);
});
console.log(n + " passed");
