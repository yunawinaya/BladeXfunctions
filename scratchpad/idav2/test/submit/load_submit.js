// loads a code node of the BUILT IDA_V2_SUBMIT.json as a module: its script minus the platform tail (lib/test_load.js's strip rule: the
// lines from "const res = " on; each built node has exactly that one tail line), returning the named functions
const fs = require("fs");
const path = require("path");
const IDAV2 = path.join(__dirname, "..", "..");
const { strip } = require(path.join(IDAV2, "lib", "test_load.js"));
// IDA_SUBMIT_BUILT points the tests at another build (the mutation runs of test/submit/mutants.py)
const BUILT = process.env.IDA_SUBMIT_BUILT || path.join(IDAV2, "..", "..", "Item Disassembly", "AsyncV2", "IDA_V2_SUBMIT.json");
let doc = null;
const nodes = () => {
  if (doc) return doc;
  doc = {};
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.id === "string" && n.type) doc[n.id] = n;
      Object.values(n).forEach(walk);
    }
  };
  walk(JSON.parse(fs.readFileSync(BUILT, "utf8")));
  return doc;
};
function load(nodeId, names) {
  const n = nodes()[nodeId];
  if (!n) throw new Error("no node " + nodeId);
  const code = n.data.script.code;
  if ((code.match(/^const res = /gm) || []).length !== 1) throw new Error(nodeId + ": not exactly one tail line");
  const src = strip(code) + "\nreturn { " + names.join(", ") + " };";
  if (/\{\{/.test(src)) throw new Error(nodeId + ": a platform token is left in the loaded body");
  return new Function(src)();
}
load.nodes = nodes;
load.BUILT = BUILT;
module.exports = load;
