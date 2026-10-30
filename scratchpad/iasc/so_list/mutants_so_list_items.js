// node scratchpad/iasc/so_list/mutants_so_list_items.js - each mutant of the By Item line actions (so_line_ias.js / the patcher) must
// make test_so_list_items.js fail (run on a mutated copy of the folder through SO_LIST_PATCHER)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const HERE = __dirname;
const H = "so_line_ias.js";
const PY = "patch_so_list_items.py";
const MUTANTS = [
  ["the action not passed", H, "sc_action: SC_ACTION }", 'sc_action: "" }'],
  ["the line index for the line id", H, "so_line_id: scText(scRow.id),", "so_line_id: scText(scRow.line_index),"],
  ["the item record passed whole", H, "item_id: scId(scRow.item_name),", "item_id: scText(scRow.item_name),"],
  ["the row's organisation used", H, 'const scOrg = so ? scId(so.organization_id) : "";', 'const scOrg = so ? scId(scSo.organization_id || so.organization_id) : "";'],
  ["an unreadable order given a guessed organisation", H, 'const scOrg = so ? scId(so.organization_id) : "";', 'const scOrg = so ? scId(so.organization_id) : "1001";'],
  ["the background save not refused", H, "  if (so && Number(so.is_processing) === 1) {", "  if (false) {"],
  ["a row without an item opens", H, " || !scDigits(scId(scRow.item_name))", ""],
  ["an order without an organisation opens", H, "  } else if (!scDigits(scOrg)) {", "  } else if (false) {"],
  ["Create IA on a Completed line", PY, "['Completed', 'Cancelled'].indexOf(arguments[0].row.line_status) >= 0", "['Cancelled'].indexOf(arguments[0].row.line_status) >= 0"],
  ["Create IA on a Cancelled order", PY, "\"['Issued', 'Processing'].indexOf(", "\"['Issued', 'Processing', 'Cancelled'].indexOf("],
  ["Linked IAs during a background save", PY, '"{{" + SAVED + " || " + BUSY + "}}"),', '"{{" + SAVED + "}}"),'],
  ["Create IA with the Linked IAs permission", PY, '("Create IA", "so_item_create_ia",', '("Create IA", "so_item_linked_ias",'],
  ["the actions before View", PY, "        acts.append(a)", "        acts.insert(0, a)"],
  ["another page opened", PY, 'PAGE = "2112449353901772801"', 'PAGE = "2112449353901772800"'],
];
let survived = 0;
for (const [name, file, from, to] of MUTANTS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "so-list-items-mut-"));
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
  const r = spawnSync("node", [path.join(HERE, "test_so_list_items.js")], { env: Object.assign({}, process.env, { SO_LIST_PATCHER: path.join(tmp, PY) }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
