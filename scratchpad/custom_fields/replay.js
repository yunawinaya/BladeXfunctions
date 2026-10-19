// Replays one code node of a recorded dev run with the BASE and the PATCHED script, after injecting custom
// fields into the source records, and prints every path where the two outputs differ.
//
//   node replay.js <run.json> <base_wf.json> <new_wf.json> <code_node_id> <inject.js> [--show path.to.value ...]
//
// <inject.js> exports (outputs, params) => void and mutates the recorded node outputs in place.
const fs = require("fs");

const [runFile, baseFile, newFile, nodeId, injectFile, ...rest] = process.argv.slice(2);

// bigint ids stay strings, as the platform hands them to code nodes
const parseJ = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));

const run = parseJ(fs.readFileSync(runFile, "utf8"))[0];
const nodes = typeof run.nodes_data === "string" ? parseJ(run.nodes_data) : run.nodes_data;
const request = typeof run.request_json_data === "string" ? parseJ(run.request_json_data) : run.request_json_data;
const params = request.workflowparams || {};

const outputs = {};
for (const n of nodes) {
  if (!n.response_json_data) continue;
  const res = typeof n.response_json_data === "string" ? parseJ(n.response_json_data) : n.response_json_data;
  outputs[n.node_id] = res;
}
require(require("path").resolve(injectFile))(outputs, params);

const findNode = (doc, id) => {
  const walk = (list) => {
    for (const n of list || []) {
      if (n.id === id) return n;
      const r = walk(n.blocks);
      if (r) return r;
    }
    return null;
  };
  return walk(doc.nodes);
};

const get = (obj, path) => path.split(".").reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj);

const resolve = (expr) => {
  const [kind, ref] = [expr.slice(0, expr.indexOf(":")), expr.slice(expr.indexOf(":") + 1)];
  if (kind === "node") {
    const dot = ref.indexOf(".");
    const id = dot < 0 ? ref : ref.slice(0, dot);
    const path = dot < 0 ? "" : ref.slice(dot + 1);
    const res = outputs[id];
    if (res === undefined) return undefined;
    return path ? get(res, path) : res;
  }
  if (kind === "workflowparams") return params[ref];
  if (kind === "global") return { nickname: "Tester", firstLvDeptId: params.organization_id || "1" }[ref];
  if (kind === "system") return { uid: "1123598821738675201", uuid: "test-uuid-1" }[ref];
  throw new Error("unknown placeholder " + expr);
};

const runCode = (file) => {
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const node = findNode(doc, nodeId);
  if (!node) throw new Error(nodeId + " not in " + file);
  const code = node.data.script.code.replace(/\{\{([a-z]+:[^{}]+)\}\}/g, (m, expr) => {
    const v = resolve(expr);
    return v === undefined ? "undefined" : JSON.stringify(v);
  });
  const fn = new Function("console", code);
  return fn({ log() {}, error() {}, warn() {} });
};

const base = runCode(baseFile);
const next = runCode(newFile);

const diffs = [];
const walk = (a, b, p) => {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) walk(a[k], b[k], p ? p + "." + k : k);
    return;
  }
  diffs.push({ path: p, base: a, next: b });
};
walk(base, next, "");

const generic = (p) => p.replace(/\.\d+(?=\.|$)/g, ".N");
const byShape = {};
for (const d of diffs) {
  const key = generic(d.path);
  if (!byShape[key]) byShape[key] = { count: 0, sample: d };
  byShape[key].count++;
}
console.log(`${nodeId}: ${diffs.length} differing paths`);
for (const [shape, { count, sample }] of Object.entries(byShape)) {
  console.log(`  ${shape}  x${count}  base=${JSON.stringify(sample.base)}  new=${JSON.stringify(sample.next)}`);
}
const showAt = rest.indexOf("--show");
if (showAt >= 0) for (const p of rest.slice(showAt + 1)) console.log("  show", p, "=", JSON.stringify(get(next, p)));
