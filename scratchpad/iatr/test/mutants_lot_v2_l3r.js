// node scratchpad/iatr/test/mutants_lot_v2_l3r.js - each mutant of scratchpad/smv2/code/commit/l3r.js (LOT_V2_COMMIT's L3_RESERVATION)
// must make test_lot_v2_l3r.js fail (run on the mutant through L3R_SRC)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "..", "smv2", "code", "commit", "l3r.js");
const TEST = path.join(__dirname, "test_lot_v2_l3r.js");
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["the step named L3R_RESERVATION (never seen by the step-rows read)", 'const L3R_STEP = "L3_RESERVATION";', 'const L3R_STEP = "L3R_RESERVATION";'],
  ["slices of 500", "const L3R_SLICE = 250;", "const L3R_SLICE = 500;"],
  ["kept: every current pick kept (the dispatched ones too)", '.filter((p) => p && typeof p === "object" && s(p.location_id) === s(rr.stagingBin) && s(p.iatr_lot_id) !== s(entry.lotId));',
    '.filter((p) => p && typeof p === "object");'],
  ["kept: this transfer's own picks kept again (a resume doubles them)", " && s(p.iatr_lot_id) !== s(entry.lotId));", ");"],
  ["the new picks not tagged", "iatr_lot_id: s(entry.lotId) });", 'iatr_lot_id: "" });'],
  ["keys: a value that is not an id reaches the SQL", "      if (!digits(p.material_id) || !digits(p.location_id) || (s(p.batch_id) && !digits(p.batch_id))) continue;\n", ""],
  ["keys: the kept picks' bins not looked up", "      if (digits(p.location_id)) locs[s(p.location_id)] = 1;\n", ""],
  ["another IA's part accepted", 'if (!digits(ia.id) || s(rr.iaId) !== s(ia.id)) return review(', "if (!digits(ia.id)) return review("],
  ["dispatch: a row another process took cancelled anyway", 'if (s(cur.status) !== "Allocated") return review(', "if (false) return review("],
  ["dispatch: the release never written", '      cancel.push({ id: id, status: "Cancelled", job_line_key: s(rr.marker) });\n', ""],
  ["dispatch: a cancelled row written again on resume", '      if (s(cur.status) === "Cancelled" && s(cur.job_line_key) === s(rr.marker)) continue;\n', ""],
  ["rows: a doubled key not reviewed", "if (have[k] > 1) return review(", "if (false) return review("],
  ["rows: added again on resume", "    if (have[k] === 1) continue;\n", ""],
  ["rows: written Processing", 'add.push({ doc_type: "Item Assembly", status: "Allocated",', 'add.push({ doc_type: "Item Assembly", status: "Processing",'],
  ["rows: no batch written as ''", "batch_id: s(h.batch_id) || null, item_uom:", "batch_id: s(h.batch_id), item_uom:"],
  ["rows: no reserved date", "reserved_date: s(c.now),", 'reserved_date: "",'],
  ["rows: no item text", "item_code: s(it.material_code),", 'item_code: "",'],
  ["picks: a missing balance not reviewed", 'if (!b || !digits(b.id)) return review("no balance row', 'if (!b) return review("no balance row'],
  ["picks: today's balance not used", "balance_id: s(b.id),", 'balance_id: "",'],
  ["picks: the dates dropped", "expired_date: p.expired_date || null,", "expired_date: null,"],
  ["picks: the quantity as text", "sm_quantity: l3rNum(p.sm_quantity), category:", "sm_quantity: s(p.sm_quantity), category:"],
  ["summary: the batch line dropped", '+ (s(p.batch_id) ? "\\n[" + (batchNo[s(p.batch_id)] || s(p.batch_id)) + "]" : "")', ""],
  ["summary: never rewritten", "    if (s(line.temp_qty_data) === text && s(line.stock_summary) === summary) continue;", "    if (s(line.temp_qty_data) === text) continue;"],
  ["defects: never written", "      lotLines.push(Object.assign({ id: id }, want));\n", ""],
  ["check: a missing row passes", 'for (const k of list(e.keys)) if (have[k] !== 1) return review(', "for (const k of list(e.keys)) if (false) return review("],
  ["check: the picks not compared", "if (!cur || l3rHash(s(cur.temp_qty_data)) !== e.ia[id].picks || l3rHash(s(cur.stock_summary)) !== e.ia[id].summary) return review(",
    "if (!cur) return review("],
  ["check: a row still Allocated passes", 'if (!rows[id] || s(rows[id].status) !== "Cancelled" || s(rows[id].job_line_key) !== s(e.marker)) return review(', "if (!rows[id]) return review("],
  // the bins to count in the request's log (Task 10)
  ["log: the bins to count never written", "        logRows.push({ id: s(entry.lotId), request_log:", "        if (false) logRows.push({ id: s(entry.lotId), request_log:"],
  ["log: written again on resume", "      if (!l3rLogged(c.log, rr.marker)) {", "      if (true) {"],
  ["log: the old entries dropped", "request_log: JSON.stringify(l3rLog(c.log).concat([{", "request_log: JSON.stringify([].concat([{"],
  ["log: an unreadable log thrown away", '    return Array.isArray(v) ? v : [{ op: "UNREADABLE", text: t.slice(0, 2000) }];\n  } catch (e) {\n    return [{ op: "UNREADABLE", text: t.slice(0, 2000) }];',
    '    return Array.isArray(v) ? v : [];\n  } catch (e) {\n    return [];'],
  ["log: the labels kept as they are", "  const out = { bin: s(p[0]), batch: s(p[1]) };", "  const out = { bin: s(label), batch: \"\" };"],
  ["log: a dispatch from the reserved bins logged too", "    if (count.length) {\n      expect.log", "    if (true) {\n      expect.log"],
  ["check: the log never checked", "  if (s(e.log) && !l3rLogged(c.log, e.log)) return review(", "  if (false) return review("],
  ["check: the log asked for after every dispatch", "    if (count.length) {\n      expect.log = s(rr.marker);\n", "    expect.log = s(rr.marker);\n    if (count.length) {\n"],
  // the IA's link back to its received request after a cancelled replacement (Task 10)
  ["relink: never written", "    if (s(ia.link) === s(entry.lotId)) linkRows.push(", "    if (false) linkRows.push("],
  ["relink: written again on resume", "    if (s(ia.link) === s(entry.lotId)) linkRows.push(", "    if (true) linkRows.push("],
  ["relink: a receipt relinks too", '  if (rr.kind === "CANCEL_BACK" && recv && (', "  if (recv && ("],
  ["relink: a link to another request moved", "(s(ia.link) === s(entry.lotId) || s(ia.link) === s(recv.id))) {\n    expect.link = s(recv.id);\n    if (s(ia.link) === s(entry.lotId)) linkRows.push(",
    "(true)) {\n    expect.link = s(recv.id);\n    if (true) linkRows.push("],
  ["check: the link never checked", "  if (s(e.link) && s((c.ia || {}).link) !== s(e.link)) return review(", "  if (false) return review("],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (base.split(from).length !== 2) {
    console.log("BROKEN mutant (anchor not found once): " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatr-l3r-mut-")), "l3r.js");
  fs.writeFileSync(f, base.replace(from, () => to));
  const r = spawnSync(process.execPath, [TEST], { env: Object.assign({}, process.env, { L3R_SRC: f }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
