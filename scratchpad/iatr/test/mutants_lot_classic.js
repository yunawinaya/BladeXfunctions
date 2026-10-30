// node scratchpad/iatr/test/mutants_lot_classic.js - each mutant of the built SM_LOCATION_TRANSFER v86 must make test_lot_classic.js fail
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IATR = path.join(__dirname, "..");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-classic-mut-"));
const b = spawnSync("python3", [path.join(IATR, "classic", "patch_lot_classic.py"), "--write"], { env: Object.assign({}, process.env, { IATR_OUT: dir }), encoding: "utf8" });
if (b.status !== 0) throw new Error(b.stderr.slice(-800));
const base = fs.readFileSync(path.join(dir, "SM_LOCATION_TRANSFER.json"), "utf8");
const J = (s) => JSON.stringify(s).slice(1, -1);
const MUTANTS = [
  ["the refusal never taken", J("'{{node:code_node_LOTrq.data.rq}}' == 'REFUSE'"), J("'{{node:code_node_LOTrq.data.rq}}' == 'NEVER'")],
  ["Save Picks writes Draft", J('=== "SAVE" ? "Requested" : saveAs;'), J('=== "SAVE" ? saveAs : saveAs;')],
  ["the Draft update ignores writeStatus", "{{node:code_node_yPlLXIZW.data.writeStatus}}", "{{workflowparams:saveAs}}"],
  ["the purpose not read", J("SELECT g.stock_movement_status,\n       g.transfer_purpose,"), J("SELECT g.stock_movement_status,\n       '' AS transfer_purpose,")],
  ["dispatch allowed in the classic", J('const rq = stale ? "REFUSE" : t.decision === "NONE" || t.decision === "SAVE" ? t.decision : "REFUSE";'),
    J('const rq = stale ? "REFUSE" : t.decision === "REFUSE" ? "REFUSE" : t.decision === "SAVE" ? "SAVE" : "NONE";')],
  ["the payload claim ignored", J("payloadPurpose: a && a.transfer_purpose, payloadStatus: a && a.stock_movement_status"), J('payloadPurpose: "", payloadStatus: ""')],
  ["a stale tab's Save Picks goes on", J('const stale = t.decision === "SAVE" && '), J('const stale = false && t.decision === "SAVE" && ')],
  ["the stored line ids not read", J("CASE WHEN g.transfer_purpose = 'IA_SUPPLY' THEN"), J("CASE WHEN g.transfer_purpose = 'NEVER' THEN")],
  ["the children of the sent lines ignored", J("for (const c of Array.isArray(r.children) ? r.children : []) if (c && typeof c === \"object\") sent.push(c);"), ""],
  ["the stored row ignored", J('const hasStored = String(g.check || "") === "YES"'), J('const hasStored = false && String(g.check || "") === "YES"')],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (base.split(from).length !== 2) {
    console.log("BROKEN mutant (anchor found " + (base.split(from).length - 1) + " times): " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatr-cm-")), "SM_LOCATION_TRANSFER.json");
  fs.writeFileSync(f, base.replace(from, to));
  const r = spawnSync(process.execPath, [path.join(__dirname, "test_lot_classic.js")], { env: Object.assign({}, process.env, { IATR_CLASSIC: f }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
