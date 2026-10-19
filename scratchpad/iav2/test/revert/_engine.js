// INVENTORY_BULK_APPLY v10's own guard and core (base/INVENTORY_BULK_APPLY.v10.json code_node_IBguard / code_node_IBplan, each
// without its platform tail) for the in-process replay of the engine (CONTRACT.md section 13: replay through the engine core).
// The source is the pinned local snapshot (base/MANIFEST.json md5), test-only; each body gets its own function scope.
const fs = require("fs");
const path = require("path");
const BASE = path.join(__dirname, "..", "..", "base", "INVENTORY_BULK_APPLY.v10.json");

function core() {
  const wf = JSON.parse(fs.readFileSync(BASE, "utf8"));
  const by = {};
  const walk = (ns) => (ns || []).forEach((n) => {
    by[n.id] = n;
    walk(n.blocks);
  });
  walk(wf.nodes);
  const body = (id, tail, name) => {
    const c = by[id].data.script.code;
    const i = c.lastIndexOf("\n" + tail);
    if (i < 0) throw new Error(id + ": no tail " + tail);
    const src = c.slice(0, i);
    if (/\{\{/.test(src)) throw new Error(id + ": a platform token is left");
    return new Function(src + "\nreturn " + name + ";")();
  };
  return { bulkGuard: body("code_node_IBguard", "return bulkGuard(", "bulkGuard"), bulkPlan: body("code_node_IBplan", "return bulkPlan(", "bulkPlan") };
}

module.exports = { core };
