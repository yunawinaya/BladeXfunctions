// plan_node_check.js <sql dump.json>: the PREPARE plan code node as the builder will assemble it (lift/runtime.js +
// lift/lifted_prepare.js + code/shared/batchnum.js + code/prepare/adapter.js + chain.js + plan.js + plan_tail.js), its
// {{node:...}} tokens substituted with JSON literals the way the platform substitutes them, run as ONE function body:
// no name collides across the files, the tail reads the reads it names, the answer has the declared shape.
// A GR that is not Processing is treated as locked by this job (as plan_live.js does). Run with TZ=Asia/Kuala_Lumpur.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
const FILES = ["lift/runtime.js", "lift/lifted_prepare.js", "code/shared/batchnum.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js", "code/prepare/plan_tail.js"];
const OUT = ["route", "code", "message", "operationKey", "organizationId", "grId", "grNo", "previousStatus", "payload", "partRows", "movements", "lineCount", "movementCount", "unlockOk"];
const S = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const vals = S._vals || {};
S.hdr = [{ j: S.hdr[0].j.replace(/"gr_status": ?"[^"]*"/, '"gr_status": "Processing"') }];
S.lock = [{ step_name: "LOCK|1", result_ref: "TEST-KEY" }];
const h = JSON.parse(S.hdr[0].j.replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const ctx = {
  "node:code_node_RPentry.data": { route: "GO", jobId: "2110999999999999999", tenantId: vals.tenantId, organizationId: vals.organizationId, plantId: String(h.plant_id),
    grId: vals.grId, idempotencyKey: "TEST-KEY", rowVersion: 1, dbNow: "2026-10-14 17:00:00", nonce: "abcd1234", previousStatus: "Draft",
    request: { v: 1, previousStatus: "Draft", answers: {}, grNo: h.gr_no } },
};
for (const k of ["hdr", "lines", "pol", "poh", "oo", "items", "setup", "bnc", "batches", "lock"]) ctx["node:sql_node_RP" + k + ".data"] = S[k];
const code = FILES.map((f) => fs.readFileSync(path.join(D, f), "utf8")).join("\n");
const missing = [];
const body = code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => {
  if (!(k in ctx)) missing.push(k);
  return JSON.stringify(ctx[k] === undefined ? null : ctx[k]);
});
if (missing.length) console.log("tokens with no value:", [...new Set(missing)].join(", "));
const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date, console: { log() {}, error() {} } };
vm.createContext(sb);
const t0 = Date.now();
const res = vm.runInContext("(function () {\n" + body + "\n})()", sb, { filename: "plan_node.js" });
const extra = Object.keys(res).filter((k) => !OUT.includes(k) && res[k] !== undefined);
console.log(`${path.basename(process.argv[2])}: ${res.route} ${res.code} ${res.message} in ${Date.now() - t0} ms; ${res.partRows.length} part rows; keys beyond the declared ones: ${extra.join(",") || "none"}`);
console.log(`code node: ${code.length} chars, ${code.split("\n").length} lines`);
