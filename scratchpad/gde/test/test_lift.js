// test_lift.js: lift/lifted_edit.js registers every node of lift/nodes.json, each body byte-identical to a fresh lift of
// that source's PINNED DEPLOYED version (lift/src.py; check_fresh.sh says whether dev still runs it).
const fs = require("fs"), vm = require("vm"), assert = require("assert"), cp = require("child_process");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const G = __dirname + "/..";
const spec = JSON.parse(fs.readFileSync(G + "/lift/nodes.json", "utf8")).sources;
const srcPath = {};
for (const l of cp.execFileSync("python3", [G + "/lift/src.py"]).toString().trim().split("\n")) { const [name, ...p] = l.split(" "); srcPath[name] = p.join(" "); }
const lifted = fs.readFileSync(G + "/lift/lifted_edit.js", "utf8");
const sb = { JSON, Math, Number, String, Array, Object, Set, Map, Error, RegExp, Date };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(R + "scratchpad/gdc/lift/runtime.js", "utf8") + "\n" + lifted + "\nthis.__ids = Object.keys(__N);", sb);
let n = 0;
for (const src of spec) {
  const wf = srcPath[src.name], ids = src.nodes;
  // a fresh lift of the same nodes, from the same file, by the same (unchanged) tool
  const tmp = fs.mkdtempSync("/tmp/gde-lift-") + "/fresh.js";
  cp.execFileSync("python3", [R + "scratchpad/gdc/lift/lift.py", tmp, wf + ":" + ids.join(",")]);
  const fresh = fs.readFileSync(tmp, "utf8");
  for (const id of ids) {
    assert(sb.__ids.includes(id), "not lifted: " + id);
    const pick = (src) => { const i = src.indexOf("__N[" + JSON.stringify(id) + "]"); assert(i >= 0, id + " missing in " + wf); const j = src.indexOf("\n} };\n", i); return src.slice(i, j); };
    assert.strictEqual(pick(lifted), pick(fresh), id + ": lifted body differs from " + src.name + " v" + src.version);
    n++;
  }
}
assert.strictEqual(sb.__ids.length, n, "lifted_edit.js has nodes outside lift/nodes.json");
console.log("test_lift: " + n + " nodes lifted, each identical to its pinned deployed version (" + spec.map((x) => x.name + " v" + x.version).join(", ") + ")");
