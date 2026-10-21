// Shared by the GR Revert V2 harnesses: a plan-core node as the builder embeds it (code/outputs.json "files" joined with
// "\n"), its {{tokens}} substituted with JSON literals the way the platform substitutes them, run as ONE function body in a
// fresh sandbox; its answer through the platform's output rules (declared keys only, nulls dropped, an object declared
// string as JSON text). A stored receipt can be presented as locked by a test job (gr_status Processing, gr_v2_job_id, a
// LOCK row of the test key). Run with TZ=Asia/Kuala_Lumpur.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");
const OUTPUTS = JSON.parse(fs.readFileSync(path.join(D, "code", "outputs.json"), "utf8"));
const TEST_JOB = "2110999999999999999";
const TEST_KEY = "GRV:TEST:KEY:0001";

function body(node) {
  return OUTPUTS.files[node].map((f) => fs.readFileSync(path.join(D, f), "utf8").replace(/\n+$/, "")).join("\n");
}

function decl(node) {
  const o = OUTPUTS[node];
  return o.fields.map((f) => [f, o.arrays.includes(f) ? "array" : o.objects.includes(f) ? "any" : "string"]);
}

function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== null && v[k] !== undefined) o[k] = strip(v[k]);
    return o;
  }
  return v;
}

function platformOut(raw, node) {
  const r = JSON.parse(JSON.stringify(raw || {}));
  const o = {};
  for (const [name, type] of decl(node)) {
    const v = r[name];
    if (v === null || v === undefined) continue;
    o[name] = type === "string" && typeof v === "object" ? JSON.stringify(v) : v;
  }
  return strip(o);
}

// clock: epoch ms for new Date() / Date.now() (a recorded run's time), or undefined for the real clock
function sandbox(clock) {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Symbol, console: { log() {}, error() {} } };
  if (clock !== undefined) {
    const RealDate = Date;
    let now = clock;
    const FakeDate = function (...a) {
      if (!(this instanceof FakeDate)) return new RealDate(now).toString();
      return a.length ? new RealDate(...a) : new RealDate(now);
    };
    FakeDate.now = () => now;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    FakeDate.prototype = RealDate.prototype;
    sb.Date = FakeDate;
  } else sb.Date = Date;
  vm.createContext(sb);
  return sb;
}

// the node's body with every token replaced by its value's JSON (missing -> null), run once; raw = the body's return value
function runNode(node, ctx, opts) {
  const o = opts || {};
  const missing = [];
  const code = body(node).replace(/\{\{([^{}]+?)\}\}/g, (m, k) => {
    if (!(k in ctx)) missing.push(k);
    return JSON.stringify(ctx[k] === undefined ? null : ctx[k]);
  });
  const sb = sandbox(o.clock);
  const t0 = process.hrtime.bigint();
  const raw = vm.runInContext("(function () {\n" + code + "\n})()", sb, { filename: node + ".js" });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { raw: raw, out: platformOut(raw, node), missing: [...new Set(missing)], ms: ms, codeLength: code.length };
}

// the functions of a node's files (without its tail) in one sandbox, for unit harnesses
function load(files, clock) {
  const sb = sandbox(clock);
  vm.runInContext(files.map((f) => fs.readFileSync(path.join(D, f), "utf8")).join("\n") + "\nthis.__set = __set; this.__run = __run; this.__N = __N;", sb);
  return sb;
}

const parseBig = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));

// a stored receipt's rows (run_prepare_sql.py) presented as locked by the test job; its job's previous status = `prev`
function locked(S, prev) {
  const h = parseBig(S.hdr[0].j);
  const was = h.gr_status;
  h.gr_status = "Processing";
  h.gr_v2_job_id = TEST_JOB;
  const hdr = [{ j: JSON.stringify(h) }];
  const entry = {
    route: "GO", jobId: TEST_JOB, tenantId: String(S._vals.tenantId), organizationId: String(h.organization_id), grId: String(h.id), idempotencyKey: TEST_KEY,
    rowVersion: 1, dbNow: "2026-10-15 12:00:00", nonce: "Ab12Cd34",
    request: { v: 1, source: "TEST", uid: "1", previousStatus: prev || (was === "Received" ? "Received" : "Completed"), grId: String(h.id), grNo: String(h.gr_no || "") },
    result_code: "", result_message: "",
  };
  return { entry: entry, hdr: hdr, lock: [{ step_name: "LOCK|1", result_ref: TEST_KEY }], was: was };
}

// the PREPARE node contexts for a stored receipt's rows: VPprep's, and VPplan's given VPprep's answer
function prepCtx(entry, S, hdr, lock) {
  return {
    "node:code_node_VPentry.data": entry, "node:sql_node_VPhdr.data": hdr || S.hdr, "node:sql_node_VPlines.data": S.lines, "node:sql_node_VPmovs.data": S.movs,
    "node:sql_node_VPlock.data": lock || S.lock,
  };
}
function planCtx(entry, prepOut, S) {
  const c = { "node:code_node_VPentry.data": entry, "node:code_node_VPprep.data": prepOut };
  for (const k of Object.keys(OUTPUTS.sql)) if (OUTPUTS.sql[k].round === 2 || ["putaway", "qi", "transit", "batches"].includes(k)) c["node:sql_node_VP" + k + ".data"] = S[k] || [];
  return c;
}
function gateCtx(entry, S) {
  return { "node:code_node_VSentry.data": entry, "node:sql_node_VShdr.data": S.hdr, "node:sql_node_VSlines.data": S.lines, "node:sql_node_VSmovs.data": S.movs };
}

module.exports = { D, OUTPUTS, TEST_JOB, TEST_KEY, body, decl, platformOut, runNode, load, sandbox, parseBig, locked, prepCtx, planCtx, gateCtx };
