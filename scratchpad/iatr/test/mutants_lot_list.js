// node scratchpad/iatr/test/mutants_lot_list.js - each mutant of patch_lot_list.py (its patch texts / additions) must make test_lot_list.js fail
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IATR = path.join(__dirname, "..");
const SRC = path.join(IATR, "lot_client");
const MUTANTS = [
  ["any Requested transfer cancelled as a request", "item.stock_movement_status === \"Requested\" && item.transfer_purpose === \"IA_SUPPLY\");", "item.stock_movement_status === \"Requested\");"],
  ["the request workflow asked the status", "{ operation: \"CANCEL\", ia_id: lv2s(lot.source_ia_id)", "{ operation: \"STATUS\", ia_id: lv2s(lot.source_ia_id)"],
  ["requests never cancelled", "'    for (const lot of requestLOTs) {\\n'", "'    for (const lot of []) {\\n'"],
  ["a refused request counted as cancelled", "'        if (lv2s(r.code) === \"200\") {\\n", "'        if (true) {\\n"],
  ["requests deleted", " && item.transfer_purpose !== \"IA_SUPPLY\",\\n    );\\n'),", ",\\n    );\\n'),"],
  ["the badge amber", "border: 2px solid #0891B2; background-color: #CFFAFE", "border: 2px solid #FFBB00; background-color: #FFFCDD"],
  ["Requested By not listed", "(\"requested_by\", \"Requested By\", \"remark3\")", "(\"remark3\", \"Requested By\", \"remark3\")"],
  ["the filter without Requested", "STATUS_KEYS = [\"Draft\", \"Requested\", \"Processing\"", "STATUS_KEYS = [\"Draft\", \"Processing\""],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-lsm-"));
  fs.mkdirSync(path.join(tmp, "lot_client", "src"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "lot_client", "out"), { recursive: true });
  fs.symlinkSync(path.join(IATR, "base"), path.join(tmp, "base"));
  for (const f of ["patch_lot_ui.py", "patch_lot_list.py"]) fs.copyFileSync(path.join(SRC, f), path.join(tmp, "lot_client", f));
  for (const f of fs.readdirSync(path.join(SRC, "src"))) fs.copyFileSync(path.join(SRC, "src", f), path.join(tmp, "lot_client", "src", f));
  const target = path.join(tmp, "lot_client", "patch_lot_list.py");
  const text = fs.readFileSync(target, "utf8");
  const k = text.split(from).length - 1;
  if (k !== 1) {
    console.log("BROKEN mutant (anchor found " + k + " times): " + name);
    survived++;
    continue;
  }
  fs.writeFileSync(target, text.replace(from, () => to));
  const r = spawnSync(process.execPath, [path.join(__dirname, "test_lot_list.js")], { env: Object.assign({}, process.env, { IATR_LIST_PATCHER: target }), encoding: "utf8", timeout: 120000 });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
