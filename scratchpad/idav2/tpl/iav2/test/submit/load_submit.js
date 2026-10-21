// loads a code node of the BUILT IA_V2_SUBMIT.json as a module: its script minus the platform tail (the lines from
// "const res = " / "const t0 = " on), returning the named functions (copy of lib/test_load.js's strip rule)
const fs = require("fs");
const path = require("path");
const BUILT = path.join(__dirname, "..", "..", "..", "..", "Item Assembly & BOM", "AsyncV2", "IA_V2_SUBMIT.json");
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
const strip = (t) => {
  const lines = t.split("\n");
  const at = lines.findIndex((l) => /^const (res|t0) = /.test(l));
  return (at < 0 ? lines : lines.slice(0, at)).join("\n");
};
function load(nodeId, names) {
  const n = nodes()[nodeId];
  if (!n) throw new Error("no node " + nodeId);
  const src = strip(n.data.script.code) + "\nreturn { " + names.join(", ") + " };";
  if (/\{\{/.test(src)) throw new Error(nodeId + ": a platform token is left in the loaded body");
  return new Function(src)();
}
load.nodes = nodes;
load.BUILT = BUILT;
module.exports = load;
