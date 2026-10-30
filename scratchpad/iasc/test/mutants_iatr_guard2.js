// node scratchpad/iasc/test/mutants_iatr_guard2.js - each mutant of code/shared/iatr_guard2.js (the IA guard for transfer requests from
// a reserved IA) must make test_iatr_guard2.js fail (run on the mutant through IATR_GUARD2)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "code", "shared", "iatr_guard2.js");
const TEST = path.join(__dirname, "test_iatr_guard2.js");
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["an unknown status not in transit", "IATRG2_KNOWN.indexOf(r.status) < 0 || IATRG2_TRANSIT.indexOf(r.status) >= 0", "IATRG2_TRANSIT.indexOf(r.status) >= 0"],
  ["Processing not in transit", 'const IATRG2_TRANSIT = ["In Progress", "Processing"];', 'const IATRG2_TRANSIT = ["In Progress"];'],
  ["a Draft save in transit goes on", "  if (moving) return { refuse: true, code: \"IA_TR_TRANSIT\"", "  if (moving && outcome !== \"DRAFT\") return { refuse: true, code: \"IA_TR_TRANSIT\""],
  ["Created refused while Requested", '  if (outcome !== "COMPLETED") return go;\n', ""],
  ["a completion with a request open goes on", "  if (open) return { refuse: true, code: \"IA_TR_OPEN\"", "  if (false) return { refuse: true, code: \"IA_TR_OPEN\""],
  ["Requested not open", 'const IATRG2_OPEN = ["Requested", "In Progress", "Processing"];', 'const IATRG2_OPEN = ["In Progress", "Processing"];'],
  ["no staging check after a receipt", 'picks: reqs.some((r) => r.status === "Completed") };', "picks: false };"],
  ["a final IA guarded again", "  if (IATRG2_FINAL.indexOf(iatrg2S(stored)) >= 0) return go;\n", ""],
  ["an unreadable read goes on", '  if (!read || read.bad) return outcome === "DRAFT" ? go : {', '  if (!read || read.bad) return go || {'],
  ["the oldest received request's bin", "const recv = (read && read.reqs ? read.reqs : []).filter((r) => r.status === \"Completed\").sort(iatrg2Newest)[0];",
    "const recv = (read && read.reqs ? read.reqs : []).filter((r) => r.status === \"Completed\").sort(iatrg2Newest).slice(-1)[0];"],
  ["a received request without a bin passes", "  if (!recv.bin) return { ok: false, code: \"IA_TR_STAGING\"", "  if (false) return { ok: false, code: \"IA_TR_STAGING\""],
  ["the given items ignored", "const c = rrStagingCheck(list, read.reqs, items || read.items, recv.bin);", "const c = rrStagingCheck(list, read.reqs, read.items, recv.bin);"],
  ["a request without an id read", "  if (!rows || !itemRows || rows.some((x) => !x || typeof x !== \"object\" || !iatrg2Id(x.id))) return bad;", "  if (!rows || !itemRows) return bad;"],
  ["bare numbers read as numbers", "(-?\\d{16,})(?=\\s*(?:[,\\]}]|$))", "(-?\\d{30,})(?=\\s*(?:[,\\]}]|$))"],
  ["the outcome: a stored Created on the Draft path stays Draft", 'targetCreated || stored === "Created" ? "CREATED" : "DRAFT"', 'targetCreated ? "CREATED" : "DRAFT"'],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (base.split(from).length !== 2) {
    console.log("BROKEN mutant (anchor not found once): " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatrg2-mut-")), "iatr_guard2.js");
  fs.writeFileSync(f, base.replace(from, () => to));
  const r = spawnSync(process.execPath, [TEST], { env: Object.assign({}, process.env, { IATR_GUARD2: f }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
