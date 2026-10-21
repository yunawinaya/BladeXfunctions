// Prints, per scenario, which nodes the new PI_SAVE ran and what it wrote (sanity check that scenarios_save.js is not vacuous)
"use strict";
const fs = require("fs");
const Module = require("module");
const src = fs.readFileSync(__dirname + "/scenarios_save.js", "utf8").replace(/let bad = 0;[\s\S]*$/, "module.exports = S;");
const m = new Module(__dirname + "/scenarios_probe.js");
m.filename = __dirname + "/scenarios_probe.js";
m.paths = Module._nodeModulePaths(__dirname);
m._compile(src, m.filename);
const { runOnce } = require("./compare.js");
const NEW = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
for (const [name, mk, data] of m.exports) {
  const r = runOnce(NEW, mk, { data });
  const w = (r.writes || []).map((x) => x.node + "x" + x.rows.length).join(" ");
  const ran = (r.order || []).filter((id) => /^(code_node_Cf|get_node_Cf|sql_node|code_pi_check|add_node|update_node)/.test(id)).join(",");
  console.log(name.padEnd(40), "| writes:", w || "-", "|", ran);
}
