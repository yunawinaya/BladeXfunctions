// revert_parity.js <fixture.json> [...]: the lifted revert nodes (lift/lifted_revert.js, pinned GD_REVERT_COMPLETED v17 /
// GD_PROCESS_REVERT v13) on recorded dev runs: the recorded reads and requests go in, each lifted node's output must equal the
// recorded one (clock values masked). A run made with another version of a node is reported as such, not as a failure.
// Fixtures: test/fetch_fixtures.py (session scratchpad). Exit 1 on a difference in a same-version node.
const fs = require("fs"), vm = require("vm");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const norm = (o) => JSON.stringify(canon(o)).replace(/"docDate":"[^"]*"/g, '"docDate":"<NOW>"').replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, "<ISO>");
const HEAD = ["code_node_hrExtract", "code_node_hrParseSnap", "code_node_hrPickParams", "code_node_hrComputeSoUpdates", "code_node_hrPickStatus"];
const CHILD = ["code_node_inExtract", "code_node_inParseSnap", "code_node_inConflictBatch"];

// the pinned sources' code per node (for the same-version check)
const pinned = {};
const SRC = process.env.GDREV_SRC || "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/15e6fc61-e726-4d06-9ece-6e8ec1b9d6be/scratchpad/gdrev-src";
for (const s of JSON.parse(fs.readFileSync(D + "/lift/nodes.json", "utf8")).sources) {
  const wf = JSON.parse(fs.readFileSync(SRC + "/" + s.name + ".v" + s.version + ".json", "utf8"));
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      if (n.type === "code-node" && s.nodes.indexOf(n.id) >= 0) pinned[n.id] = n.data.script.code;
      Object.values(n).forEach(walk);
    }
  })(wf.nodes);
}

let same = 0, diff = 0, older = 0, missing = 0, bad = 0;
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!fx.child) { console.log(fx.head.id, "no inventory call (exit " + fx.head.current_node_id + "): skipped"); continue; }
  // a big run keeps some reads / code in files the trace does not inline: its nodes would run on missing inputs
  if (/"(request|response)_is_writer_file":true/.test(fx.head.nodes_data + fx.child.nodes_data)) { console.log(fx.head.id, fx.gd_no, "recorded partly in files: skipped"); continue; }
  const rec = {}, recCode = {};
  for (const src of [fx.head, fx.child]) {
    for (const n of P(src.nodes_data || "[]")) {
      if (!n.node_id || rec[n.node_id] !== undefined) continue;
      if (n.response_is_writer_file) { rec[n.node_id] = "<file>"; continue; }
      try { rec[n.node_id] = P(n.response_json_data || "{}").data; } catch (e) { rec[n.node_id] = undefined; }
      if (n.node_type === "code-node" && n.request_json_data && !n.request_is_writer_file) recCode[n.node_id] = P(n.request_json_data).code;
    }
  }
  const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(R + "scratchpad/gdc/lift/runtime.js", "utf8"), sb);
  vm.runInContext(fs.readFileSync(D + "/lift/lifted_revert.js", "utf8") + "\nthis.__run = __run; this.__withContext = __withContext;", sb);
  const reads = (ids) => Object.fromEntries(Object.keys(rec).filter((k) => !/^code-node|^code_node/.test(k) && rec[k] !== "<file>").map((k) => ["node:" + k, { data: rec[k] }]));
  const headReq = P(fx.head.request_json_data).request_json || {};
  const childReq = P(fx.child.request_json_data).request_json || {};
  const ctxOf = (req) => Object.assign(Object.fromEntries(Object.entries(req).map(([k, v]) => ["workflowparams:" + k, v])), reads());
  const report = [];
  const runAll = (ids, ctx) => sb.__withContext(ctx, () => {
    for (const id of ids) {
      if (rec[id] === undefined) continue;
      let out;
      try { out = sb.__run(id); } catch (e) { report.push([id, "THROW " + e.message]); bad++; return; }
      if (rec[id] === "<file>") { report.push([id, "recorded in a file"]); missing++; continue; }
      const sameVer = recCode[id] === undefined || recCode[id] === pinned[id];
      const ok = norm(out) === norm(rec[id]);
      if (ok) { same++; report.push([id, "same" + (sameVer ? "" : " (older code)")]); }
      else if (!sameVer) { older++; report.push([id, "differs, run used older code"]); }
      else { diff++; report.push([id, "DIFFERS"]); const a = norm(out), b = norm(rec[id]); let i = 0; while (i < a.length && a[i] === b[i]) i++; report.push(["", "  lifted:   " + a.slice(Math.max(0, i - 80), i + 160)]); report.push(["", "  recorded: " + b.slice(Math.max(0, i - 80), i + 160)]); }
      ctx["node:" + id] = { data: rec[id] === "<file>" ? out : rec[id] };
    }
  });
  const headCtx = ctxOf(headReq);
  runAll(HEAD.slice(0, 4), headCtx);
  runAll(CHILD, ctxOf(childReq));
  runAll(["code_node_hrPickStatus"], headCtx);
  console.log(fx.head.id, fx.gd_no, report.map(([i, s]) => (i ? i.replace(/^code_node_/, "") + ": " + s : s)).join("\n    "));
}
console.log(`\nsame ${same}, differs ${diff}, differs-on-older-code ${older}, recorded-in-file ${missing}, threw ${bad}`);
if (diff || bad) process.exit(1);
