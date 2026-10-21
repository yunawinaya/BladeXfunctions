// test_lock_leak.js <candidate.json>: patch_replay_release.py's nodes run on crafted lock rows (offline), each case also on deployed v10
// (Balance Table/INVENTORY_BULK_APPLY.json) where the leak should still show: claim / verify / release accept a key this operation left
// half-released (token 0, owner empty, last owner = it), the replay branch releases, and every reference in the replay branch points
// into that branch or at the guard. Prints each check; exit 1 on a failure.
const fs = require("fs");
const assert = require("assert");
const NEW = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const OLD = JSON.parse(fs.readFileSync(process.argv[3] || __dirname + "/base/INVENTORY_BULK_APPLY.live_v10.json", "utf8"));
const V12 = !!find0(NEW, "sql_node_IBrunMe");
function find0(n, id) {
  if (Array.isArray(n)) { for (const x of n) { const r = find0(x, id); if (r) return r; } return null; }
  if (n && typeof n === "object") { if (n.id === id) return n; for (const v of Object.values(n)) { const r = find0(v, id); if (r) return r; } }
  return null;
}
const find = (n, id) => {
  if (Array.isArray(n)) { for (const x of n) { const r = find(x, id); if (r) return r; } return null; }
  if (n && typeof n === "object") {
    if (n.id === id) return n;
    for (const v of Object.values(n)) { const r = find(v, id); if (r) return r; }
  }
  return null;
};
// a code node's body with every {{node:...}} placeholder replaced by the JSON of ctx[path]
const run = (doc, id, ctx) => {
  const code = find(doc, id).data.script.code.replace(/\{\{node:([^}]+)\}\}/g, (_, p) => {
    if (!(p in ctx)) throw new Error(id + " reads " + p + ", not in the test context");
    return JSON.stringify(ctx[p]);
  });
  return new Function(code)();
};
const OP = "GDR|1001";
const KEYS = ["COST|11|90", "ITEM|11|21", "ITEM|12|21"];
const row = (key, token, owner, last, id) => ({ id: String(id), lock_key: key, free_token: token, owner_operation_id: owner, last_owner_operation_id: last, lock_version: 3, db_now: "2026-10-21 15:00:00" });
const guard = { "code_node_IBguard.data.operationKey": OP, "code_node_IBguard.data.lockKeys": KEYS };
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };

const claim = (doc, rows) => run(doc, "code_node_IBclaim", Object.assign({ "sql_node_IBlk2.data": rows }, guard));
t("claim: all free -> TAKE", () => assert.strictEqual(claim(NEW, KEYS.map((k, i) => row(k, 1, "", "", 10 + i))).route, "TAKE"));
t("claim: its own held key is kept, the rest taken", () => {
  const r = claim(NEW, [row(KEYS[0], 0, OP, "", 10), row(KEYS[1], 1, "", "", 11), row(KEYS[2], 1, "", "", 12)]);
  assert.deepStrictEqual([r.route, r.ids], ["TAKE", ["11", "12"]]);
});
const half = [row(KEYS[0], 0, "", OP, 10), row(KEYS[1], 0, OP, "", 11), row(KEYS[2], 1, "", "x", 12)];
t("claim: its own half-released key counts as held (v10: BUSY, its own key blocks it)", () => {
  assert.deepStrictEqual([claim(NEW, half).route, claim(NEW, half).ids], ["TAKE", ["12"]]);
  assert.strictEqual(claim(OLD, half).route, "BUSY");
});
t("claim: another operation's half-released or held key is BUSY", () => {
  assert.strictEqual(claim(NEW, [row(KEYS[0], 0, "", "GDR|2", 10), row(KEYS[1], 1, "", "", 11), row(KEYS[2], 1, "", "", 12)]).route, "BUSY");
  assert.strictEqual(claim(NEW, [row(KEYS[0], 0, "GDR|2", "", 10), row(KEYS[1], 1, "", "", 11), row(KEYS[2], 1, "", "", 12)]).route, "BUSY");
});
t("claim: everything already its own -> HELD", () => assert.strictEqual(claim(NEW, [row(KEYS[0], 0, "", OP, 10), row(KEYS[1], 0, OP, "", 11), row(KEYS[2], 0, OP, "", 12)]).route, "HELD"));

const verify = (doc, rows) => run(doc, "code_node_IBlkv", Object.assign({ "sql_node_IBlk3.data": rows }, guard));
t("verify: owned + its own half-released -> HELD (v10: LOST)", () => {
  const rows = [row(KEYS[0], 0, "", OP, 10), row(KEYS[1], 0, OP, "", 11), row(KEYS[2], 0, OP, "", 12)];
  assert.strictEqual(verify(NEW, rows).route, "HELD");
  assert.strictEqual(verify(OLD, rows).route, "LOST");
});
t("verify: a key free, another's, or half-released by another -> LOST", () => {
  for (const bad of [row(KEYS[2], 1, "", OP, 12), row(KEYS[2], 0, "GDR|2", "", 12), row(KEYS[2], 0, "", "GDR|2", 12)]) {
    assert.strictEqual(verify(NEW, [row(KEYS[0], 0, OP, "", 10), row(KEYS[1], 0, OP, "", 11), bad]).route, "LOST");
  }
});

const mixed = [row(KEYS[0], 0, OP, "", 10), row(KEYS[1], 0, "", OP, 11), row(KEYS[2], 0, "", "GDR|2", 12), row("ITEM|13|21", 0, "GDR|2", OP, 13), row("ITEM|14|21", 1, "", OP, 14)];
const release = (doc, id, sqlId, rows) => run(doc, id, Object.assign({ [sqlId + ".data"]: rows }, guard));
for (const [id, sqlId] of [["code_node_IBrelease", "sql_node_IBrel"], ["code_node_IBrpRelease", "sql_node_IBrpRel"]]) {
  t(id + ": owned -> clear + GIVE, its own half-released -> GIVE only, others untouched", () => {
    const r = release(NEW, id, sqlId, mixed);
    assert.deepStrictEqual(r.clearRows.map((x) => [x.id, x.owner_operation_id, x.last_owner_operation_id, x.lock_version]), [["10", "", OP, 4]]);
    assert.deepStrictEqual([r.plusIds, r.needRelease, r.batches.length], [["10", "11"], "YES", 1]);
  });
  t(id + ": only a half-released key -> GIVE with no clear slice", () => {
    const r = release(NEW, id, sqlId, [row(KEYS[1], 0, "", OP, 11)]);
    assert.deepStrictEqual([r.clearRows.length, r.batches.length, r.plusIds, r.needRelease], [0, 0, ["11"], "YES"]);
  });
  t(id + ": nothing of this operation -> NO", () => assert.strictEqual(release(NEW, id, sqlId, [row(KEYS[2], 0, "", "GDR|2", 12), row(KEYS[0], 1, "", OP, 10)]).needRelease, "NO"));
}
t("v10's release leaves its own half-released key out (the leak)", () => {
  assert.deepStrictEqual(release(OLD, "code_node_IBrelease", "sql_node_IBrel", mixed).plusIds, ["10"]);
});
t("v10 on fully owned rows = the candidate (no behaviour change for a clean release)", () => {
  const clean = [row(KEYS[0], 0, OP, "", 10), row(KEYS[1], 0, OP, "", 11), row(KEYS[2], 1, "", "", 12)];
  const a = release(OLD, "code_node_IBrelease", "sql_node_IBrel", clean), b = release(NEW, "code_node_IBrelease", "sql_node_IBrel", clean);
  if (V12) delete b.dbNow;  // v12 hands back the clock for its GIVE heartbeat
  assert.deepStrictEqual(a, b);
});

t("the replay slice slices the replay plan's clearRows", () => {
  const clearRows = Array.from({ length: 260 }, (_, i) => ({ id: String(100 + i) }));
  const ctx = { "code_node_IBrpRelease.data.clearRows": clearRows, "get_cache_IBrpIdx.data": "1", "get_cache_IBrpIdx.data.data": "1", "get_cache_IBrpIdx.data.value": "1" };
  const code = find(NEW, "code_node_IBrpSlice").data.script.code;
  const used = Array.from(code.matchAll(/\{\{node:([^}]+)\}\}/g), (m) => m[1]);
  const r = run(NEW, "code_node_IBrpSlice", Object.fromEntries(used.map((p) => [p, ctx[p]])));
  assert.deepStrictEqual([r.rows.length, r.rows[0].id, r.count, r.nextIndex], [10, "350", "10", "2"]);
});
t("every reference in the replay branch points into it or at the guard / state", () => {
  const branch = find(NEW, "if_IBreplay").blocks[0];
  const inside = new Set();
  (function ids(n) {
    if (Array.isArray(n)) return n.forEach(ids);
    if (n && typeof n === "object") { if (typeof n.id === "string") inside.add(n.id); Object.values(n).forEach(ids); }
  })(branch);
  const text = JSON.stringify(branch);
  const refs = new Set([...text.matchAll(/\{\{node:([A-Za-z0-9_]+)\./g), ...text.matchAll(/"node\.([A-Za-z0-9_]+)\./g)].map((m) => m[1]));
  // v12's run marker: the replay branch also ends its own marker (the read-back id)
  const outside = [...refs].filter((r) => !inside.has(r) && r !== "code_node_IBguard" && r !== "code_node_IBstate" && !(V12 && r === "code_node_IBrunMe"));
  assert.deepStrictEqual(outside, []);
  assert.ok(text.includes("iba_rp_") && !text.includes("iba_rl_"), "replay cache keys");
  const give = find(branch, "workflow_node_IBrpGive").data;
  assert.strictEqual(give.workflow.source, find(NEW, "workflow_node_IBgive").data.workflow.source);
  assert.deepStrictEqual(give.body_params.list.map((p) => p.prop + "=" + p.value), ["mode=GIVE", "operation_id={{node:code_node_IBguard.data.operationKey}}",
    "organization_id={{node:code_node_IBguard.data.organizationId}}", "claimed_at=", "ids={{node:code_node_IBrpRelease.data.plusIds}}"]);
});
if (!V12) t("outside the changed nodes the candidate equals v10", () => {
  const changed = new Set(["sql_node_IBlk2", "sql_node_IBlk3", "sql_node_IBrel", "code_node_IBclaim", "code_node_IBlkv", "code_node_IBrelease", "if_IBreplay"]);
  const strip = (doc) => JSON.stringify(doc, (k, v) => (v && typeof v === "object" && changed.has(v.id) ? { id: v.id } : v));
  assert.strictEqual(strip(NEW), strip(OLD));
});
console.log(n + " passed");
