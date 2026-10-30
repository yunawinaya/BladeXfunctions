// node scratchpad/iatr/test/mutants_ia_list.js - each mutant of the IA list patcher (ia_client/patch_ia_list.py: the cancel guard,
// RESERVED_REQUEST_PLAN.md Task 10) must make test_ia_list.js fail. The test reads the mutated copy's build AND patch texts.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IATR = path.join(__dirname, "..");
const SRC = path.join(IATR, "ia_client", "patch_ia_list.py");
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["an open request ignored", ".indexOf(s(q.stock_movement_status)) >= 0) open[", ".indexOf(s(q.stock_movement_status)) < 0) open["],
  ["Processing not open", 'OPEN = ["Requested", "In Progress", "Processing"]', 'OPEN = ["Requested", "In Progress"]'],
  ["a received request blocks", 'OPEN = ["Requested", "In Progress", "Processing"]', 'OPEN = ["Requested", "In Progress", "Processing", "Completed"]'],
  ["unreadable requests: cancelled anyway", "'  if (!reqs) {\\n'", "'  if (false) {\\n'"],
  ["another purpose's transfers read", '{ prop: "transfer_purpose", operator: "equal", value: "IA_SUPPLY" }, ', ""],
  ["deleted transfers read", ', { prop: "is_deleted", operator: "equal", value: 0 }] }])\\n', "] }])\\n"],
  ["the loop sends an open one", "'      if (open[id]) {\\n'", "'      if (false) {\\n'"],
  ["the confirm silent about the held ones", "'      (held ? ` ${held} of the selected", "'      (false ? ` ${held} of the selected"],
  ["every one open: asked anyway", "cancel the request first.\");\\n'\n     '    return;\\n  }\\n'),", "cancel the request first.\");\\n'\n     '  }\\n'),"],
  ["the Draft rows' requests read too", "value: created.map((r) => s(r.id)) }", "value: selected.map((r) => s(r.id)) }"],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  const k = base.split(from).length - 1;
  if (k !== 1) {
    console.log("BROKEN mutant (anchor found " + k + " times): " + name);
    survived++;
    continue;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-ialm-"));
  fs.mkdirSync(path.join(tmp, "ia_client"));
  fs.symlinkSync(path.join(IATR, "base"), path.join(tmp, "base"));
  fs.writeFileSync(path.join(tmp, "ia_client", "patch_ia_list.py"), base.replace(from, () => to));
  const r = spawnSync(process.execPath, [path.join(__dirname, "test_ia_list.js")], { env: Object.assign({}, process.env, { IATR_IA_LIST_PATCHER: path.join(tmp, "ia_client", "patch_ia_list.py") }),
    encoding: "utf8", timeout: 120000 });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name + (/Traceback|AssertionError/.test(r.stdout + r.stderr) ? " (the build refused it)" : ""));
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
