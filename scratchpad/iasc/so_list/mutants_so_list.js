// node scratchpad/iasc/so_list/mutants_so_list.js - each mutant of the plant check (so_plant_check.js / the patcher's call) must make
// test_so_list.js fail (run on a mutated copy of the folder through SO_LIST_PATCHER)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const HERE = __dirname;
const H = "so_plant_check.js";
const PY = "patch_so_list.py";
const MUTANTS = [
  ["the IAs not read", H, "((ias && ias.data) || []).filter(", "([]).filter("],
  ["the production reservations not read", H, "((prod && prod.data) || []).filter(", "([]).filter("],
  ["a cancelled IA counts", H, 'str(x.item_assembly_status) !== "Cancelled" && other(', "other("],
  ["the chosen plant counts as another", H, ' && str(p) !== plant;', ";"],
  ["a delivered reservation counts", H, '{ prop: "status", operator: "equal", value: "Pending" }, ', ""],
  ["any reservation type counts", H, '{ prop: "doc_type", operator: "equal", value: "Production" },\n          ', ""],
  ["a failed read blocks the convert", H, '- converting as before", e);\n    return true;', '- converting as before", e);\n    return false;'],
  ["Cancel converts anyway", H, "  } catch (e) {\n    return false;\n  }\n};", "  } catch (e) {\n    return true;\n  }\n};"],
  ["the IA not named", H, '"Item Assembly " + str(x.stock_movement_no)', '"an Item Assembly"'],
  ["the call missing", PY, '"      if (!(await soPlantElsewhere(selectedRecords, plantID))) return;\\n")', '"")'],
];
let survived = 0;
for (const [name, file, from, to] of MUTANTS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "so-list-mut-"));
  for (const f of [H, PY]) fs.copyFileSync(path.join(HERE, f), path.join(tmp, f));
  fs.mkdirSync(path.join(tmp, "base"));
  for (const f of fs.readdirSync(path.join(HERE, "base"))) fs.copyFileSync(path.join(HERE, "base", f), path.join(tmp, "base", f));
  const p = path.join(tmp, file);
  const text = fs.readFileSync(p, "utf8");
  if (text.split(from).length !== 2) {
    console.log("BROKEN mutant (anchor not found once): " + name);
    survived++;
    continue;
  }
  fs.writeFileSync(p, text.replace(from, to));
  const r = spawnSync("node", [path.join(HERE, "test_so_list.js")], { env: Object.assign({}, process.env, { SO_LIST_PATCHER: path.join(tmp, PY) }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
