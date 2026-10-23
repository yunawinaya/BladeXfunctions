// test_engine_precheck_wait.js: INVENTORY_APPLY_OPERATION's claim list (code_node_J6YxjhQw) and the precheck busy branch
// (code_node_LKbusy00), run from the patched repo JSON with their placeholders filled as the platform fills them.
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/INVENTORY_APPLY_OPERATION.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const code = (id) => find(W, id).data.script.code;
const fill = (src, vals) => src.replace(/\{\{node:([A-Za-z0-9_.]+)\}\}/g, (m, name) => {
  if (!(name in vals)) throw new Error("no value for " + m);
  return JSON.stringify(vals[name]);
});
const run = (id, vals) => { const log = console.log; console.log = () => {}; try { return new Function(fill(code(id), vals))(); } finally { console.log = log; } };
const KEYS = ["BATCH|1|2|3", "ITEM|1|2"];
const rows = (tokens) => KEYS.map((k, i) => ({ id: String(100 + i), lock_key: k, free_token: tokens[i], is_deleted: 0, db_now: "2026-10-23 12:00:05" }));
const claim = (tokens, precheck) => run("code_node_J6YxjhQw", { "code_node_cW0Exw93.data.plan": { lockKeys: KEYS }, "code_node_cW0Exw93.data.precheck": precheck, "sql_node_i9QBqwL2.data": rows(tokens) });
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got))); if (!ok) fails += 1; };

let c = claim([1, 0], true);
t("claim: one key taken -> busy YES with the key, no throw, ids still listed", c.busy === "YES" && c.takenKeys === "ITEM|1|2" && c.count === 2 && c.ids.join() === "100,101", c);
c = claim([1, 1], true);
t("claim: every key free -> busy NO", c.busy === "NO" && c.takenKeys === "" && c.claimedAt === "2026-10-23 12:00:05", c);
c = claim([0, 0], false);
t("claim: precheck off (the protocol's own option) -> busy NO, as before", c.busy === "NO", c);
let threw = "";
try { claim([1, 2], true); } catch (e) { threw = e.message; }
t("claim: a token neither 0 nor 1 -> still INV_LOCK_BREACH", /INV_LOCK_BREACH/.test(threw), threw);
threw = "";
try { run("code_node_J6YxjhQw", { "code_node_cW0Exw93.data.plan": { lockKeys: KEYS }, "code_node_cW0Exw93.data.precheck": true, "sql_node_i9QBqwL2.data": rows([1, 1]).slice(0, 1) }); } catch (e) { threw = e.message; }
t("claim: a key without a lock row -> still INV_LOCK_SEED_INCOMPLETE", /INV_LOCK_SEED_INCOMPLETE/.test(threw), threw);

const busy = (leaseRows, dbNow, taken) => run("code_node_LKbusy00", {
  "code_node_AbCxKTsM.data.leaseRows": leaseRows, "code_node_AbCxKTsM.data.dbNow": dbNow,
  "code_node_J6YxjhQw.data.takenKeys": taken, "code_node_cW0Exw93.data.operationId": "GD|2113473909914472449|2",
});
let b = busy([{ id: "555", lease_expires_at: "2026-10-23 12:10:05" }], "2026-10-23 12:00:05", "ITEM|1|2");
t("busy: our lease -> expired to the DB time just read, OPERATION_IN_PROGRESS for the same operation",
  b.expire === "YES" && b.expireRows.length === 1 && b.expireRows[0].id === "555" && b.expireRows[0].lease_expires_at === "2026-10-23 12:00:05" &&
  b.operation_id === "GD|2113473909914472449|2" && b.operation_status === "REJECTED" && b.result_code === "OPERATION_IN_PROGRESS" && b.review_reference === "", b);
t("busy: the message and evidence name the taken key", /ITEM\|1\|2/.test(b.result_message) && JSON.parse(b.evidence).steps.claim.taken[0] === "ITEM|1|2" && JSON.parse(b.evidence).path === "LOCK_TAKEN_PRECHECK", b);
t("busy: effect_summary is the contract's empty summary", JSON.parse(b.effect_summary).effect_count === 0, b.effect_summary);
b = busy([], "2026-10-23 12:00:05", "ITEM|1|2");
t("busy: the lease is not this run's (renewal said NO) -> nothing expired, still OPERATION_IN_PROGRESS", b.expire === "NO" && b.expireRows.length === 0 && b.result_code === "OPERATION_IN_PROGRESS", b);
b = busy([{ id: "555" }], "", "ITEM|1|2");
t("busy: no DB time -> nothing expired", b.expire === "NO", b);
b = busy([{ id: "555" }], "2026-10-23 12:00:05", Array.from({ length: 8 }, (_, i) => "K" + i).join(","));
t("busy: 8 keys -> 5 named in the message, then '...'", /K4, \.\.\.\)/.test(b.result_message) && JSON.parse(b.evidence).steps.claim.taken_count === 8, b.result_message);
const ret = find(W, "return_node_LKbusy00").data.response_value.list.map((x) => x.prop + "=" + x.value);
t("return node: the engine's 7 response fields, from the busy node", ret.length === 7 && ret.every((x) => x.includes("code_node_LKbusy00.data.")), ret);

// RECOVER done (patch_engine_recover_release.py, NOT published: dev's el_expression column is full): only when the node exists
if (find(W, "code_node_LKrel00")) {
const rel = (leaseRows, dbNow, readBack, owned) => run("code_node_LKrel00", {
  "code_node_ojWiBEFP.data.leaseRows": leaseRows, "code_node_ojWiBEFP.data.dbNow": dbNow, "sql_node_pIDMqTob.data": readBack, "sql_node_Wy0KIuXT.data": owned,
});
const RB = (status) => [{ kind: "OP", k: status, v: "LOCK_CONFLICT", n: "4" }, { kind: "GATE", k: "GATE|op", v: "REJECT|LOCK_CONFLICT|x", n: "0" }, { kind: "LOCKS_OWNED", k: "", v: "", n: "0" }];
let x = rel([{ id: "777", lease_expires_at: "2026-10-23 12:40:00" }], "2026-10-23 12:30:00", RB("REJECTED"), []);
t("recover: ours, REJECTED, nothing owned -> lease expired to the DB time read before the release", x.expire === "YES" && x.expireRows[0].id === "777" && x.expireRows[0].lease_expires_at === "2026-10-23 12:30:00", x);
x = rel([], "2026-10-23 12:30:00", RB("REJECTED"), []);
t("recover: the lease is not this run's -> untouched", x.expire === "NO" && x.expireRows.length === 0, x);
x = rel([{ id: "777" }], "2026-10-23 12:30:00", RB("LOCKING"), []);
t("recover: the read-back is not REJECTED -> untouched", x.expire === "NO", x);
x = rel([{ id: "777" }], "2026-10-23 12:30:00", RB("REJECTED"), [{ id: "9", lock_key: "COST|1|2", owner_operation_id: "op" }]);
t("recover: a lock still owned (COST included) -> untouched", x.expire === "NO", x);
x = rel([{ id: "777" }], "2026-10-23 12:30:00", { kind: "OP", k: "REJECTED", v: "LOCK_CONFLICT", n: "4" }, null);
t("recover: one-row answers (an object; no owned rows) -> expired", x.expire === "YES", x);
}
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
