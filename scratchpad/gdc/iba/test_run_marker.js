// test_run_marker.js <candidate.json>: patch_run_marker.py's decision nodes on crafted rows (offline), v11 (Balance Table/INVENTORY_BULK_APPLY.json
// or base/INVENTORY_BULK_APPLY.live_v11.json) as the control where outputs must not change: the run gate (BUSY / CLAIM / SKIP, next
// generation, the 20-min heartbeat), the marker read-back, the fence (OK / SUPERSEDED, release only behind an ENDED + DONE run), the
// clock outputs IBlkv / IBrelease gained. Prints each check; exit 1 on a failure.
const fs = require("fs");
const assert = require("assert");
const NEW = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const OLD = JSON.parse(fs.readFileSync(process.argv[3] || __dirname + "/../../../Balance Table/INVENTORY_BULK_APPLY.json", "utf8"));
const find = (n, id) => {
  if (Array.isArray(n)) { for (const x of n) { const r = find(x, id); if (r) return r; } return null; }
  if (n && typeof n === "object") {
    if (n.id === id) return n;
    for (const v of Object.values(n)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
const run = (doc, id, ctx) => new Function(find(doc, id).data.script.code.replace(/\{\{node:([^}]+)\}\}/g, (_, p) => {
  if (!(p in ctx)) throw new Error(id + " reads " + p + ", not in the test context");
  return JSON.stringify(ctx[p]);
}))();
const NOW = "2026-10-21 17:30:00";
const ago = (min) => { const d = new Date(Date.parse(NOW.replace(" ", "T")) - min * 60000); const p = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); };
const step = (name, status, extra) => Object.assign({ step_name: name, step_status: status, result_ref: "", error_message: "", id: "9" + name.length, heartbeat: null, db_now: NOW }, extra || {});
const state = (doc, mode, rows) => run(doc, "code_node_IBstate", { "sql_node_IBops.data": rows.length ? rows : [{ step_name: null, db_now: NOW }], "code_node_IBguard.data.mode": mode });
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };

t("no marker yet: APPLY claims generation 1", () => {
  const r = state(NEW, "APPLY", []);
  assert.deepStrictEqual([r.route, r.runGate, r.runGen, r.runStep, r.runMessage], ["FRESH", "CLAIM", "1", "IBA|RUN|001", ""]);
});
t("a RUNNING marker with a 5-min heartbeat: BUSY, nothing claimed", () => {
  const r = state(NEW, "APPLY", [step("IBA|RUN|001", "RUNNING", { heartbeat: ago(5) })]);
  assert.strictEqual(r.runGate, "BUSY");
  assert.ok(/still running \(run 1, last heartbeat/.test(r.runMessage), r.runMessage);
});
t("a RUNNING marker with a 25-min heartbeat (the run died): CLAIM generation 2", () => {
  const r = state(NEW, "APPLY", [step("IBA|RUN|001", "RUNNING", { heartbeat: ago(25) })]);
  assert.deepStrictEqual([r.runGate, r.runStep], ["CLAIM", "IBA|RUN|002"]);
});
t("19 min still counts as alive; 20 min does not", () => {
  assert.strictEqual(state(NEW, "APPLY", [step("IBA|RUN|001", "RUNNING", { heartbeat: ago(19) })]).runGate, "BUSY");
  assert.strictEqual(state(NEW, "APPLY", [step("IBA|RUN|001", "RUNNING", { heartbeat: ago(20) })]).runGate, "CLAIM");
});
t("ENDED markers: CLAIM the next generation after the highest", () => {
  const r = state(NEW, "APPLY", [step("IBA|RUN|002", "ENDED", { heartbeat: ago(1) }), step("IBA|RUN|001", "ENDED", { heartbeat: ago(9) })]);
  assert.deepStrictEqual([r.runGate, r.runStep], ["CLAIM", "IBA|RUN|003"]);
});
t("only the LATEST generation decides (an older RUNNING one that never ended is ignored)", () => {
  assert.strictEqual(state(NEW, "APPLY", [step("IBA|RUN|001", "RUNNING", { heartbeat: ago(1) }), step("IBA|RUN|002", "ENDED", { heartbeat: ago(1) })]).runGate, "CLAIM");
  assert.strictEqual(state(NEW, "APPLY", [step("IBA|RUN|003", "RUNNING", { heartbeat: ago(2) }), step("IBA|RUN|002", "ENDED", { heartbeat: ago(9) })]).runGate, "BUSY");
});
t("PLAN and REVIEW write nothing: SKIP, even with a live marker", () => {
  const live = step("IBA|RUN|001", "RUNNING", { heartbeat: ago(1) });
  assert.strictEqual(state(NEW, "PLAN", [live]).runGate, "SKIP");
  assert.deepStrictEqual([state(NEW, "APPLY", [live, step("IBA|REVIEW", "REVIEW", { error_message: "x" })]).route, state(NEW, "APPLY", [live, step("IBA|REVIEW", "REVIEW")]).runGate], ["REVIEW", "SKIP"]);
});
t("REPLAY while the first run is alive (releasing): BUSY; after it ended: CLAIM (the replay release runs)", () => {
  const done = step("IBA|DONE", "DONE", { result_ref: JSON.stringify({ results: [{ movement_key: "A" }], summary: { movements: 1 } }) });
  assert.deepStrictEqual([state(NEW, "APPLY", [done, step("IBA|RUN|001", "RUNNING", { heartbeat: ago(3) })]).route, state(NEW, "APPLY", [done, step("IBA|RUN|001", "RUNNING", { heartbeat: ago(3) })]).runGate], ["REPLAY", "BUSY"]);
  assert.strictEqual(state(NEW, "APPLY", [done, step("IBA|RUN|001", "ENDED", { heartbeat: ago(3) })]).runGate, "CLAIM");
});
t("v11's outputs are unchanged (route, intent, stored answer, review reason) on every case above", () => {
  const cases = [[], [step("IBA|DONE", "DONE", { result_ref: JSON.stringify({ results: [1], summary: { a: 1 } }) })], [step("IBA|REVIEW", "REVIEW", { error_message: "why" })],
    [step("IBA|I|002", "INTENT", { result_ref: "b" }), step("IBA|I|001", "INTENT", { result_ref: "a" }), step("IBA|RUN|001", "RUNNING", { heartbeat: ago(30) })]];
  for (const mode of ["APPLY", "PLAN"]) for (const c of cases) {
    const a = state(OLD, mode, c), b = state(NEW, mode, c);
    for (const k of Object.keys(a)) assert.deepStrictEqual(b[k], a[k], mode + " " + k);
  }
});

const me = (rows, nonce) => run(NEW, "code_node_IBrunMe", { "sql_node_IBrunMe.data": rows, "code_node_IBguard.data.nonce": nonce });
t("the marker read back: own only with this run's nonce and a numeric id", () => {
  assert.deepStrictEqual(me([{ id: "123", result_ref: "abc", db_now: NOW }], "abc"), { own: "YES", runId: "123", dbNow: NOW });
  assert.strictEqual(me([{ id: "123", result_ref: "zzz" }], "abc").own, "NO");
  assert.strictEqual(me([], "abc").own, "NO");
});
const fence = (row, mine) => run(NEW, "code_node_IBfence", { "sql_node_IBfence.data": [row], "code_node_IBstate.data.runGen": mine });
t("the fence: the latest generation is this run's -> OK, no release", () => {
  assert.deepStrictEqual([fence({ latest_gen: "2", latest_status: "RUNNING", done: "0", db_now: NOW }, "2").route, fence({ latest_gen: "2", latest_status: "RUNNING", done: "0" }, "2").release], ["OK", "NO"]);
});
t("superseded by a later run that ENDED with DONE -> give back the keys this run took", () => {
  const r = fence({ latest_gen: "3", latest_status: "ENDED", done: "1", db_now: NOW }, "2");
  assert.deepStrictEqual([r.route, r.release, r.dbNow], ["SUPERSEDED", "YES", NOW]);
  assert.ok(/run 3 after this run 2/.test(r.message));
});
t("superseded by a later run still RUNNING, or ENDED without DONE -> no release (the keys are its)", () => {
  assert.deepStrictEqual([fence({ latest_gen: "3", latest_status: "RUNNING", done: "1" }, "2").release, fence({ latest_gen: "3", latest_status: "ENDED", done: "0" }, "2").release], ["NO", "NO"]);
});
t("no marker found at the fence -> SUPERSEDED (write nothing), no release", () => {
  const r = fence({ latest_gen: null, latest_status: null, done: "0" }, "1");
  assert.deepStrictEqual([r.route, r.release], ["SUPERSEDED", "NO"]);
});

const OP = "GDR|1001";
const KEYS = ["COST|11|90", "ITEM|11|21"];
const lk = (key, id) => ({ id: String(id), lock_key: key, free_token: 0, owner_operation_id: OP, last_owner_operation_id: "", lock_version: 2, db_now: NOW });
t("lock verify also hands back the clock; its route is v11's", () => {
  const ctx = { "code_node_IBguard.data.lockKeys": KEYS, "code_node_IBguard.data.operationKey": OP, "sql_node_IBlk3.data": [lk(KEYS[0], 10), lk(KEYS[1], 11)] };
  const a = run(OLD, "code_node_IBlkv", ctx), b = run(NEW, "code_node_IBlkv", ctx);
  assert.deepStrictEqual([b.route, b.lost, b.lostCount, b.dbNow], [a.route, a.lost, a.lostCount, NOW]);
});
t("the release plan also hands back the clock; the plan is v11's", () => {
  const ctx = { "code_node_IBguard.data.operationKey": OP, "sql_node_IBrel.data": [lk(KEYS[0], 10), Object.assign(lk(KEYS[1], 11), { owner_operation_id: "", last_owner_operation_id: OP })] };
  const a = run(OLD, "code_node_IBrelease", ctx), b = run(NEW, "code_node_IBrelease", ctx);
  assert.deepStrictEqual(Object.assign({}, b, { dbNow: undefined }), Object.assign({}, a, { dbNow: undefined }));
  assert.strictEqual(b.dbNow, NOW);
});
t("the superseded release copy plans exactly as the release", () => {
  const rows = [lk(KEYS[0], 10), Object.assign(lk(KEYS[1], 11), { owner_operation_id: "", last_owner_operation_id: OP })];
  const a = run(OLD, "code_node_IBrelease", { "code_node_IBguard.data.operationKey": OP, "sql_node_IBrel.data": rows });
  const b = run(NEW, "code_node_IBfzRelease", { "code_node_IBguard.data.operationKey": OP, "sql_node_IBfzRel.data": rows });
  assert.deepStrictEqual(b, a);
});
t("every marker update targets the marker row by the read-back id, and ENDED / heartbeat values are right", () => {
  const ups = ["update_node_IBrunEndRp", "update_node_IBrunEndBusy", "update_node_IBrunEndFence", "update_node_IBrunEnd", "update_node_IBrunHb1", "update_node_IBrunHb2", "update_node_IBrunHb3"];
  for (const id of ups) {
    const d = find(NEW, id).data;
    assert.ok(/GD Publish Step:Table:/.test(d.table_id.source), id);
    const props = Object.fromEntries(d.props.list.map((p) => [p.prop, p.value]));
    assert.strictEqual(props.id, "{{node:code_node_IBrunMe.data.runId}}", id);
    if (/End/.test(id)) assert.strictEqual(props.step_status, "ENDED", id);
    else assert.ok(/dbNow\}\}$/.test(props.finished_at), id);
  }
});
console.log(n + " passed");
