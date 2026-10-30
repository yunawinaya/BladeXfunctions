// node scratchpad/iatr/test/mutants_iatr_ia2.js - each mutant of code/shared/iatr_ia2.js (IA_TRANSFER_REQUEST v8's rules) must make
// test_iatr_ia2.js fail (run on the mutant through IATR_IA2)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "code", "shared", "iatr_ia2.js");
const TEST = path.join(__dirname, "test_iatr_ia2.js");
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["the setup ignored", '    if (!setupOn) return answer(400, "Transfer requests are turned off in Item Assembly Setup.");\n', ""],
  ["a Draft IA requests", '  if (status !== "Created") {\n    return answer(400, "Only a Created', '  if (false) {\n    return answer(400, "Only a Created'],
  ["unsaved edits pass", 'if (op !== "DEFECT" && iatrS(x.expectFp) !== iatrIaFp(iatrBasis(ia), x.iaLines)) {', "if (false) {"],
  ["a second open request", 'if (reqs.live) return answer(200, "This Item Assembly already has', 'if (false) return answer(200, "This Item Assembly already has'],
  ["CREATE after a receipt", "    if (received) {\n      return answer(409,", "    if (false) {\n      return answer(409,"],
  ["REPLACE to any bin", "if (iatrId(x.storage) !== staging.storage || iatrId(x.binId) !== staging.bin) {", "if (false) {"],
  ["the staging bin's holds requested again", "const r = rrLinesFromHolds(x.iaLines, holds, items, bin);", 'const r = rrLinesFromHolds(x.iaLines, holds, items, "");'],
  ["the non-stock lines named as skipped", '{ lines: r.lines, skipped: r.skipped.filter((k) => k.reason !== "not stock-controlled") }', "{ lines: r.lines, skipped: r.skipped }"],
  ["the picks without the IA's balance ids", "balance_id: iatrS(m.balance_id),", 'balance_id: "",'],
  ["the picks without their dates", "expired_date: m.expired_date || null,", "expired_date: null,"],
  ["the lines' Selected Qty left 0", "Object.assign(row, { total_quantity: total.toFixed(8),", 'Object.assign(row, { total_quantity: "0.00000000",'],
  ["REFRESH rewrites an unchanged request", 'if (fp === iatrS(named.fp)) return answer(200,', "if (false) return answer(200,"],
  ["REFRESH of a dispatched request", 'if (iatrS(named.status) !== "Requested") return answer(400, "Only a Requested transfer request can be refreshed',
    'if (false) return answer(400, "Only a Requested transfer request can be refreshed'],
  ["STATUS never stale", '(rrReqFp(fromHolds(iatrId(r.bin)).lines) !== iatrS(r.fp) ? "YES" : "NO")', '("NO")'],
  ["STATUS: may create with the setup off", 'can_create: setupOn && status === "Created"', 'can_create: status === "Created"'],
  ["STATUS: no gap", "gap: received && !reqs.live ? rrGap(x.iaLines, holds, [], items) : [],", "gap: [],"],
  ["STATUS: a replacement always ready", '&& fromHolds(staging.bin).lines.length > 0 ? "YES" : "NO" });', '? "YES" : "NO" });'],
  ["DEFECT: Reserved stays Reserved", 'inventory_category: "Blocked" }, base,', 'inventory_category: "Reserved" }, base,'],
  ["DEFECT: the add not priced from its subtract", "base, { unit_price_from: k }));", "base));"],
  ["DEFECT: the log restarted", "request_log: iatrLog(received.log, entry)", 'request_log: iatrLog("", entry)'],
  ["DEFECT: nothing to move goes on", '    if (!d.moves.length) return answer(400, "Enter the defective quantity', '    if (false) return answer(400, "Enter the defective quantity'],
  ["the replacement replaces an older cancel", "const replacesId = c && (op === \"CREATE\" || iatrNewest(c, received) < 0) ? iatrS(c.id) : \"\";", "const replacesId = c ? iatrS(c.id) : \"\";"],
  ["the replacement not linked", 'replacementForId: op === "REPLACE" ? iatrS(received.id) : "",', 'replacementForId: "",'],
  ["defects: negative quantities", 'const qty = (x) => iatrS(x) !== "" && isFinite(Number(x)) && Number(x) >= 0;', 'const qty = (x) => iatrS(x) !== "" && isFinite(Number(x));'],
  ["defects: a long reason", "if (o.reason.length > 255) return bad(", "if (false) return bad("],
  ["defects: batch ids that are not ids", "if (!digits(b) || !qty(d.batches[b])) return bad(", "if (!qty(d.batches[b])) return bad("],
  ["defects: an empty object", '  if (!Object.keys(out).length) return bad("at least one line");\n', ""],
  ["summary: the batch line dropped", '+ (iatrS(p.batch_id) ? "\\n[" + (batchNo[iatrS(p.batch_id)] || iatrS(p.batch_id)) + "]" : "")', ""],
  ["win: the IA's status not checked", 'if (op !== "CANCEL" && iatrS(s0.status) !== "Created") return lose(', "if (false) return lose("],
  ["win: a request appearing meanwhile ignored", 'if ((op === "CREATE" || op === "REPLACE") && reqs.live) return lose(', "if (false) return lose("],
  ["win: REPLACE without its receipt", 'if ((op === "REPLACE" || op === "DEFECT") && !reqs.received) return lose(', "if (false) return lose("],
  ["win: an older live claim ignored", "if (!me || !first || iatrS(first.name) !== iatrS(me.name)) return lose(", "if (!me) return lose("],
  // CANCEL: the IA's link back to its received request (Task 10)
  ["cancel: never relinked", "      relink: back ? { id: iatrS(ia.id), transfer_request_id: iatrS(back.id), transfer_request_no: iatrS(back.no) } : null };", "      relink: null };"],
  ["cancel: relinked to a deleted IA", "    const back = ia && reqs.received && ", "    const back = reqs.received && "],
  ["cancel: relinked to the newest request whatever it is", "    const back = ia && reqs.received && iatrS(reqs.received.id) !== iatrS(n.id) ? reqs.received : null;",
    "    const back = ia && reqs.latest && iatrS(reqs.latest.id) !== iatrS(n.id) ? reqs.latest : null;"],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (base.split(from).length !== 2) {
    console.log("BROKEN mutant (anchor not found once): " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatr-ia2-mut-")), "iatr_ia2.js");
  fs.writeFileSync(f, base.replace(from, () => to));
  const r = spawnSync(process.execPath, [TEST], { env: Object.assign({}, process.env, { IATR_IA2: f }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
