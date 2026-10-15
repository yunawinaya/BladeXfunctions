// Harness (a): every lifted GOODS_RECEIVING body that ran at the top level of a recorded "Save as Completed" run, re-run
// on that run's own recorded inputs (request + every recorded node output), against the output it recorded.
// usage: node lifted_vs_recorded.js <fixtures.jsonl> [...]   (fixtures from fetch_gr_runs.py, session scratchpad only)
// Each node runs with the clock at its recorded start (new Date() / Date.now()); ISO instants are still masked, the
// platform takes them a few ms into the node. Reports per node: same / different (with paths) / recorded code differs.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const D = path.join(__dirname, "..");

const TOP = ["code_node_mlTvKeIR", "code_node_4r2Fv9G5", "code_node_wMQADp4i", "code_node_QB3GUnrS", "code_node_Ga3BZDyy",
  "code_node_e9pINRwN", "code_node_origReserved", "code_node_ApplyBatches", "code_node_KAeXsqwm", "code_node_pdqxs8pN",
  "code_node_UQWzCg37", "code_node_jo9g6Ldx", "code_node_ITrows", "code_node_2Cq2eMRb"];
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const mask = (s) => s.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<ISO>");
const rewrite = (code) => code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => "__v(" + JSON.stringify(k) + ")");

function sandbox() {
  const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp };
  const RealDate = Date;
  let now = RealDate.now();
  function FakeDate(...a) {
    if (!(this instanceof FakeDate)) return new RealDate(now).toString();
    return a.length ? new RealDate(...a) : new RealDate(now);
  }
  FakeDate.now = () => now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  FakeDate.prototype = RealDate.prototype;
  sb.Date = FakeDate;
  sb.__setNow = (t) => { now = t; };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(D + "/lift/runtime.js", "utf8"), sb);
  vm.runInContext(fs.readFileSync(D + "/lift/lifted_prepare.js", "utf8") + "\nthis.__N = __N; this.__run = __run; this.__setCtx = (c) => { __CTX = c; };", sb);
  return sb;
}

function diffPaths(a, b, p, out) {
  if (out.length > 8) return;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) out.push(`${p}: ${a.length} items | rec ${b.length}`);
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths(a[k], b[k], p + "." + k, out);
  } else out.push(`${p}: ${JSON.stringify(a)?.slice(0, 90)} | rec ${JSON.stringify(b)?.slice(0, 90)}`);
}

const sb = sandbox();
// the deployed (repo) source per node, to tell a version difference from a port difference
const wf = JSON.parse(fs.readFileSync(path.join(D, "..", "..", "Goods Receiving", "GRsaveWorkflow.json"), "utf8"));
const src = {};
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.type === "code-node" && o.data && o.data.script) src[o.id] = o.data.script.code;
    Object.values(o).forEach(walk);
  }
})(wf);

const tally = {};
const notes = [];
let runs = 0;
for (const file of process.argv.slice(2)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    runs++;
    const ctx = { "system:tenantId": r.tenant, "system:uuid": "x" };
    for (const [k, v] of Object.entries(r.params || {})) if (v !== null && v !== undefined) ctx["workflowparams:" + k] = v;
    for (const [id, n] of Object.entries(r.nodes)) if (!id.includes("#") && n.resp && n.resp.data !== undefined) ctx["node:" + id] = { data: n.resp.data };
    const ids = TOP.filter((id) => r.nodes[id]);
    // CHECK_REQUIRED_FIELD's script, through the workflow node's recorded answer
    if (r.nodes.workflow_node_MiB8SGwF && r.nodes.code_node_wMQADp4i) ids.push("code_node_AeSdXE85");
    for (const id of ids) {
      const t = (tally[id] = tally[id] || { same: 0, diff: 0, oldSame: 0, oldDiff: 0, threw: 0 });
      let rec;
      let old = false;
      const nodeCtx = Object.assign({}, ctx);
      if (id === "code_node_AeSdXE85") {
        const w = r.nodes.code_node_wMQADp4i.resp.data;
        nodeCtx["workflowparams:entry"] = w.data;
        nodeCtx["workflowparams:required_fields"] = w.required_fields;
        rec = ((r.nodes.workflow_node_MiB8SGwF.resp || {}).data || {}).data;
        sb.__setNow(r.nodes.workflow_node_MiB8SGwF.t0 || r.t0);
      } else {
        const n = r.nodes[id];
        rec = n.resp ? n.resp.data : undefined;
        old = n.code !== undefined && src[id] !== undefined && n.code !== src[id];
        sb.__setNow(n.t0 || r.t0);
      }
      if (rec === undefined) continue;
      sb.__setCtx(nodeCtx);
      let mine;
      try {
        mine = sb.__run(id);
      } catch (e) {
        t.threw++;
        notes.push(`${r.env} ${r.id} ${id} THREW ${String(e).slice(0, 120)}`);
        continue;
      }
      const a = mask(JSON.stringify(canon(mine)));
      const b = mask(JSON.stringify(canon(rec)));
      if (a === b) t[old ? "oldSame" : "same"]++;
      else if (old) t.oldDiff++;
      else {
        t.diff++;
        const out = [];
        diffPaths(JSON.parse(a), JSON.parse(b), "", out);
        notes.push(`${r.env} ${r.id} ${id} (${r.params.pageStatus}, exit ${r.exit}):\n      ` + out.join("\n      "));
      }
    }
  }
}
console.log("runs", runs);
for (const [id, t] of Object.entries(tally)) console.log(`  ${id.padEnd(26)} same ${String(t.same).padStart(4)}  different ${String(t.diff).padStart(3)}  threw ${t.threw}   | runs of an older deployed body: same ${t.oldSame}, different ${t.oldDiff}`);
for (const n of notes.slice(0, Number(process.env.SHOW || 40))) console.log("  " + n);
