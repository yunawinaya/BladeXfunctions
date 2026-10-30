// node scratchpad/iasc/test/mutants_iatr_guard.js - each mutant of code/shared/iatr_guard.js must make test_iatr_guard.js fail ("all" = every copy)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const FILE = path.join(__dirname, "..", "code", "shared", "iatr_guard.js");
const base = fs.readFileSync(FILE, "utf8");
const MUTANTS = [
  ["parse: 16+ digit numbers read as numbers", "JSON.parse(String(t).replace(", "JSON.parse(String(t)) || (String(t).replace("],
  ["parse: an object not taken as it is", '  if (t !== null && typeof t === "object") return t;\n  try {', "  try {"],
  ["id: an unsafe number not marked", 'Number.isSafeInteger(v) && v >= 0 ? String(v) : "?" + String(v)', "String(v)"],
  ["picks of a line: a zero quantity counted", "(parseFloat(p.sm_quantity) || 0) > 0", "(parseFloat(p.sm_quantity) || 0) >= 0"],
  ["picks of a line: an array ignored", "const list = Array.isArray(v) ? v : iatrgParse(v);", "const list = Array.isArray(v) ? [] : iatrgParse(v);"],
  ["request: a blank value is bad", '(typeof v === "string" && v.trim() === "")', "false"],
  ["request: a value not JSON = none", '  if (!r || typeof r !== "object" || !iatrgId(r.id)) return { bad: true };', '  if (!r || typeof r !== "object" || !iatrgId(r.id)) return null;'],
  ["request: no id accepted", ' || !iatrgId(r.id)) return { bad: true };', ") return { bad: true };"],
  ["request: a Cancelled one taken", '  if (iatrgS(r.status) === "Cancelled") return null;\n', ""],
  ["request: lines not an array accepted", "  if (r.lines !== undefined && r.lines !== null && !Array.isArray(r.lines)) return { bad: true };\n", ""],
  ["request: blank line ids kept", "if (iatrgId(x)) lines[iatrgId(x)] = true;", "lines[iatrgId(x)] = true;"],
  ["request: the bin not as an id", "bin: iatrgId(r.bin)", "bin: String(r.bin)"],
  ["request: the bin's name dropped", "binName: iatrgS(r.bin_name)", 'binName: ""'],
  ["outcome: the Draft path ignored", '(!draftPath ? "COMPLETED"', '(false ? "COMPLETED"'],
  ["outcome: ia_target_status Created ignored", 'targetCreated || stored === "Created"', 'stored === "Created"'],
  ["outcome: a stored Created ignored", 'targetCreated || stored === "Created"', "targetCreated"],
  ["outcome: Created matched loosely", 'stored === "Created" ? "CREATED"', 'iatrgS(stored).toLowerCase() === "created" ? "CREATED"'],
  ["decide: Draft saves guarded", '(outcome !== "CREATED" && outcome !== "COMPLETED") || ', ""],
  ["decide: Created not guarded", 'outcome !== "CREATED" && outcome !== "COMPLETED"', 'outcome !== "COMPLETED"'],
  ["decide: a completed IA guarded", " || IATRG_FINAL.indexOf(iatrgS(stored)) >= 0) return go;", ") return go;"],
  ["decide: Fully Posted not final", 'const IATRG_FINAL = ["Completed", "Fully Posted"];', 'const IATRG_FINAL = ["Completed"];'],
  ["decide: an unreadable request goes on", "  if (req.bad) return {", "  if (false) return {"],
  ["decide: a received request refused", "  if (req.status === IATRG_RECEIVED) return {", "  if (false) return {"],
  ["decide: received, its picks never checked", "picks: Object.keys(req.lines).length > 0 };", "picks: false };"],
  ["decide: received without lines still checked", "picks: Object.keys(req.lines).length > 0 };", "picks: Object.keys(req.lines).length >= 0 };"],
  ["decide: a live request goes on", '  return { refuse: true, code: "IA_TR_LIVE"', '  return go || { refuse: true, code: "IA_TR_LIVE"'],
  ["decide: only the 3 known live statuses refused", '  return { refuse: true, code: "IA_TR_LIVE"',
    '  if (["Requested", "In Progress", "Processing"].indexOf(req.status) < 0) return go;\n  return { refuse: true, code: "IA_TR_LIVE"'],
  ["decide: the live message names the id", 'IATRG_TEXT.live(req.no || req.id, ', "IATRG_TEXT.live(req.id, "],
  ["decide: no status not named", 'req.status || "without a status"', "req.status"],
  ["picks: the request's lines skipped", "req.lines[iatrgId(l.id)] !== true) continue;", "req.lines[iatrgId(l.id)] === true) continue;"],
  ["picks: every line checked", " || req.lines[iatrgId(l.id)] !== true) continue;", ") continue;"],
  ["picks: the line's id as given", "req.lines[iatrgId(l.id)] !== true", "req.lines[l.id] !== true"],
  ["picks: any property counts as a request line", "req.lines[iatrgId(l.id)] !== true", "!req.lines[iatrgId(l.id)]"],
  ["picks: one pick at the destination is enough", "iatrgPicksOf(l).some((p) => !at(p))", "iatrgPicksOf(l).every((p) => !at(p))"],
  ["picks: a blank destination matches a blank bin", 'const at = (p) => req.bin !== "" && ', "const at = (p) => "],
  ["picks: bins compared as numbers", "iatrgId(p.location_id) === req.bin", "Number(p.location_id) === Number(req.bin)"],
  ["picks: Line n from the payload's line_index", "IATRG_TEXT.pick(i + 1, ", "IATRG_TEXT.pick(l.line_index || i + 1, "],
  ["picks: no item fallback", "iatrgS(l.item_name) || iatrgId(l.item_selection)", "iatrgS(l.item_name)"],
  ["picks: no bin-name fallback to the id", 'req.binName || req.bin || "its destination bin"', 'req.binName || "its destination bin"'],
  ["picks: no request-number fallback", "        req.no || req.id) };", "        req.no) };"],
  ["text: the live wording", "): receive it first, or cancel it.", "): receive it first."],
  ["text: the pick wording", ", where transfer request ", ", where request "],
];
let survived = 0;
for (const [name, from, to, mode] of MUTANTS) {
  const n = base.split(from).length - 1;
  if (n < 1 || (mode !== "all" && n !== 1)) {
    console.log("BROKEN mutant (anchor found " + n + " times): " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatrg-m-")), "iatr_guard.js");
  fs.writeFileSync(f, mode === "all" ? base.split(from).join(to) : base.replace(from, () => to));
  const r = spawnSync(process.execPath, [path.join(__dirname, "test_iatr_guard.js")], { env: Object.assign({}, process.env, { IATR_GUARD: f }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
