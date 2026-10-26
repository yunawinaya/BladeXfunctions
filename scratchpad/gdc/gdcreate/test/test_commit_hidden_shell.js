// test_commit_hidden_shell.js: GD_BULK_COMMIT keeps the save-time Packing shell hidden ("Waiting") until a Picking fills it
// (patch_commit_hidden_packing_shell.py). Runs the live code of P2 check, P7A plan and P7B check from the workflow file.
// usage: node test_commit_hidden_shell.js [GD_BULK_COMMIT.json]   (the repo file by default; today's version fails 3 cases)
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const quiet = (f) => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };
const load = (nodeId, fn) => {
  const src = find(W, nodeId).data.script.code;
  const cut = src.indexOf("const guard = [{{node:code_node_WaEyJtlE.data}}][0];");
  return quiet(() => new Function(src.slice(0, cut) + "\nreturn { fn: " + fn + " };")()).fn;
};
let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got).slice(0, 400))); if (!ok) fails += 1; };

const p2Check = load("code_node_HGbnLhvZ", "publishP2Check");
const p7a = load("code_node_SlxWSQ0R", "publishP7A");
const p7b = load("code_node_w5PAtzWc", "publishP7B");
const guard = { route: "CONTINUE", jobId: "77", tenantId: "128671", leaseOwner: "PUB|abc", nonce: "abc" };
const pre = (required) => ({ dbNow: "2026-10-26 12:00:00", operationId: "GD|77|1", attempt: 1, rowVersion: 5, organizationId: "1", plantId: "2",
  steps: {}, stepsDone: {}, resKeys: ["77|L1|0"], packing: { required: required, packing_mode: "Detail", packing_no_type: "R1" },
  jobRows: [{ id: "77", job_status: "COMMITTING_GD", attempt_count: 0, row_version: 5, lease_owner: "PUB|abc" }] });
const p1 = { gdId: "901", gdNo: "GD-2610-9901", headerIds: ["901"], lineIds: ["902"], hasHeader: "YES", hasLines: "YES", lineIdByKey: {}, eventId: "EV1" };
const pack = (v) => (v ? [{ kind: "PACK", id: "PK1", v: v, deleted: "0" }] : []);

// P2 check: the shell P2 wrote, as a re-entered pass finds it
const struct = (v) => [{ kind: "RES", id: "R1", k: "77|L1|0", x: "901", v: "Processing", n: "10", deleted: "0" }].concat(pack(v));
const c2 = (required, v) => quiet(() => p2Check(guard, pre(required), p1, struct(v), [], []));
t("P2 check: packing required, shell Processing (just written) -> CONTINUE", c2(1, "Processing").route === "CONTINUE", c2(1, "Processing").result_message);
t("P2 check: shell Waiting (a pass re-entered after P7A) -> CONTINUE", c2(1, "Waiting").route === "CONTINUE", c2(1, "Waiting").result_message);
t("P2 check: shell Created (flipped by an earlier version) -> CONTINUE", c2(1, "Created").route === "CONTINUE", c2(1, "Created").result_message);
t("P2 check: shell Completed -> clean failure, as before", c2(1, "Completed").route === "FAIL_CLEAN", c2(1, "Completed").route);
t("P2 check: packing required but no shell -> clean failure, as before (P2 still writes it)", c2(1, null).route === "FAIL_CLEAN" && /was not written/.test(c2(1, null).result_message), c2(1, null).result_message);
t("P2 check: packing not required but a shell exists -> clean failure, as before", c2(0, "Processing").route === "FAIL_CLEAN", c2(0, "Processing").route);

// P7A plan: the flip of the shell
const rows7a = (v) => [{ kind: "OUTBOX", id: "O1", v: "BLOCKED", k: "77" }, { kind: "GD", id: "901", v: "Processing" }, { kind: "RESID", id: "R1", v: "Processing" }].concat(pack(v));
const a = (v) => quiet(() => p7a(guard, pre(1), p1, rows7a(v)));
const flipTo = (r) => (r.packFlipRows || []).map((x) => x.id + ":" + x.packing_status).join(",");
t("P7A: shell Processing -> flipped to Waiting (not Created)", a("Processing").route === "CONTINUE" && flipTo(a("Processing")) === "PK1:Waiting", flipTo(a("Processing")));
t("P7A: the GD and its reservations are still published as before", (a("Processing").createdRows || []).length === 1 && (a("Processing").resFlipRows || []).length === 1, a("Processing"));
t("P7A: shell already Waiting (re-entered) -> no second flip", flipTo(a("Waiting")) === "", flipTo(a("Waiting")));
t("P7A: shell Created by a Picking or an earlier version -> left alone", flipTo(a("Created")) === "", flipTo(a("Created")));
t("P7A: no shell -> nothing to flip", flipTo(a(null)) === "", flipTo(a(null)));

// P7B check: the shell after the flip
const rows7b = (v) => [{ kind: "GD", id: "901", v: "Created" }, { kind: "OUTBOX", id: "O1", v: "BLOCKED" }, { kind: "RESID", id: "R1", v: "Allocated" }].concat(pack(v));
const b = (required, v) => quiet(() => p7b(guard, pre(required), p1, rows7b(v)));
t("P7B: packing required, shell Waiting -> CONTINUE", b(1, "Waiting").route === "CONTINUE", b(1, "Waiting").result_message);
t("P7B: shell Created (an earlier version's flip) -> CONTINUE", b(1, "Created").route === "CONTINUE", b(1, "Created").result_message);
t("P7B: shell still Processing (the flip did not land) -> review, as before", b(1, "Processing").route === "REVIEW" && /Processing/.test(b(1, "Processing").result_message), b(1, "Processing").result_message);
t("P7B: shell missing -> review, as before", b(1, null).route === "REVIEW" && /missing/.test(b(1, null).result_message), b(1, null).result_message);
t("P7B: packing not required, no shell -> CONTINUE", b(0, null).route === "CONTINUE", b(0, null).result_message);

console.log(fails ? fails + " FAILED" : "all passed");
process.exitCode = fails ? 1 : 0;
