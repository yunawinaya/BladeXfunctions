// node scratchpad/iatr/test/mutants_iatr_reserve.js - each mutant of code/shared/iatr_reserve.js must make test_iatr_reserve.js fail
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "code", "shared", "iatr_reserve.js");
const TEST = path.join(__dirname, "test_iatr_reserve.js");
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["setup: any organisation's row", "rrS(r.organization_id) === rrS(orgId) && ", ""],
  ["setup: the switch not read", "return !!row && Number(row.transfer_request_enabled) === 1;", "return !!row;"],
  ["lines: non-stock requested", '    if (!rrIsStock(it)) {\n      skipped.push({ line: id, reason: "not stock-controlled" });', '    if (false) {\n      skipped.push({ line: id, reason: "not stock-controlled" });'],
  ["lines: serial requested", '    if (rrIsSerial(it)) {\n      skipped.push({ line: id, reason: "serial-numbered', '    if (false) {\n      skipped.push({ line: id, reason: "serial-numbered'],
  ["holds: any status counts", 'rrS(h.status) === "Allocated" && ', ""],
  ["lines: the demand requested, not what is held", "requested_qty: rrQT(held),", "requested_qty: rrQT(l.requested_qty),"],
  ["lines: nothing reserved still requested", "    if (!(held > RR_EPS)) {\n      skipped.push", "    if (false) {\n      skipped.push"],
  ["holds: the staging bin's holds requested again", "    && (rrBlank(awayFrom) || rrS(h.bin_location) !== rrS(awayFrom)));", ");"],
  ["lines: the staging bin not passed", "rrOwnHolds(holdRows, id, stagingBin)", "rrOwnHolds(holdRows, id)"],
  ["swap: the destination not passed", "rrOwnHolds(holdRows, l.source_ia_line_id, l.location_id)", "rrOwnHolds(holdRows, l.source_ia_line_id)"],
  ["receive: the batch dates dropped", "}, datesOf[e.batch] || rrDates(null)));", "}, rrDates(null)));"],
  ["cancel back: the dates dropped", "        category: \"Unrestricted\" }, rrDates(p)));", "        category: \"Unrestricted\" }, rrDates(null)));"],
  ["dispatch check: the line count not compared", "  if (!st.length || st.length !== inc.length) return changed;", "  if (!st.length) return changed;"],
  ["dispatch check: the destination not compared", '["item_selection", "quantity_uom", "source_ia_line_id", "storage_location_id", "location_id"].some(', '["item_selection", "quantity_uom", "source_ia_line_id", "storage_location_id"].some('],
  ["dispatch check: a pick of another item passes", 'if (rrS(p.material_id || l.item_selection) !== rrS(l.item_selection)) return stop("IATR_PICK_ITEM"', 'if (false) return stop("IATR_PICK_ITEM"'],
  ["dispatch check: a handling-unit pick passes", 'if (rrS(p.handling_unit_id) && rrS(p.handling_unit_id) !== "0") return stop("IATR_PICK_HU"', 'if (false) return stop("IATR_PICK_HU"'],
  ["dispatch check: a pick at the staging bin passes", 'if (rrS(p.location_id) === rrS(l.location_id)) return stop("IATR_PICK_AT_DESTINATION"', 'if (false) return stop("IATR_PICK_AT_DESTINATION"'],
  ["dispatch check: the reservation not compared", 'const sw = rrSwapPlan(inc, holdRows, "");\n  return sw.ok ?', 'const sw = { ok: true };\n  return sw.ok ?'],
  ["receipts: the batches dropped", "    if (rc.batches && typeof rc.batches === \"object\" && !Array.isArray(rc.batches)) {\n      o.batches = {};", "    if (false) {\n      o.batches = {};"],
  ["receipts: lines of the payload alone kept", "  for (const l of Array.isArray(lotLines) ? lotLines : []) {\n    if (!l || typeof l !== \"object\") continue;\n    const rc = rec[rrS(l.id)];", "  for (const l of Object.keys(rec).map((k) => ({ id: k }))) {\n    if (!l || typeof l !== \"object\") continue;\n    const rc = rec[rrS(l.id)];"],
  ["swap: picks not compared", 'if (Math.abs(picked - want) > RR_EPS) return fail("IATR_PICKS_SHORT"', 'if (false) return fail("IATR_PICKS_SHORT"'],
  ["swap: the reservation not compared", "if (Math.abs(held - want) > RR_EPS || own.some(", "if (false && own.some("],
  ["swap: released to Blocked", 'from_category: "Reserved", to_category: "Unrestricted", hold_row_id', 'from_category: "Reserved", to_category: "Blocked", hold_row_id'],
  ["swap: released rows left live", "      out.cancelRows.push(rrS(h.id));\n", ""],
  ["swap: bins to count never named", "if (pickedAt[k] - (heldAt[k] || 0) > RR_EPS) out.countBins.push(", "if (false) out.countBins.push("],
  ["swap: no operation marker", 'const marker = "IATR|" + rrS(opKey);', 'const marker = "";'],
  ["receive: good + defect not compared", "|| Math.abs(e.good + e.defect - (byBatch[e.batch] || 0)) > RR_EPS) {", ") {"],
  ["receive: defect without a reason", 'if (defectTotal > RR_EPS && !rrS(rc.reason)) return fail(', "if (false) return fail("],
  ["receive: a line without a receipt passes", '    if (!rc || typeof rc !== "object") return fail(', "    if (false) return fail("],
  ["receive: good lands free", 'to_category: "Reserved" }, move)', 'to_category: "Unrestricted" }, move)'],
  ["receive: no reservation rows", "        out.newHoldRows.push(rrRowOf(ctx, ia, l.item_selection, ctx.location_id, e.batch, e.good, l.quantity_uom, k));\n", ""],
  ["receive: batches merged", "      if (batches.length > 1) return fail(", "      if (false) return fail("],
  ["receive: the base unit, not the line's", 'uom: rrS(l.quantity_uom), from_category: "In Transit" };', 'uom: "EA", from_category: "In Transit" };'],
  ["receive: defect not Blocked", 'to_category: "Blocked" }, move)', 'to_category: "Reserved" }, move)'],
  ["cancel back: to the destination, not the picked bin", "location_id: rrS(p.location_id), batch_id: rrS(p.batch_id), quantity: rrQT(p.sm_quantity), uom: rrS(l.quantity_uom), from_category: \"In Transit\",",
    "location_id: rrS(l.location_id), batch_id: rrS(p.batch_id), quantity: rrQT(p.sm_quantity), uom: rrS(l.quantity_uom), from_category: \"In Transit\","],
  ["cancel back: no reservation rows", "      out.newHoldRows.push(rrRowOf(c, ia, material, p.location_id, p.batch_id, p.sm_quantity, l.quantity_uom, k));\n", ""],
  ["defect: more than reserved allowed", 'if (e.qty - avail > RR_EPS) return fail("IATR_DEFECT_TOO_MUCH"', 'if (false) return fail("IATR_DEFECT_TOO_MUCH"'],
  ["defect: no reason needed", 'if (!rrS(df.reason)) return fail("IATR_DEFECT_REASON"', 'if (false) return fail("IATR_DEFECT_REASON"'],
  ["defect: the picks kept", "    out.iaPicks[id] = picks;", "    out.iaPicks[id] = rrPicks(l);"],
  ["defect: not IA-D", 'transaction_type: "IA-D" });', 'transaction_type: "IA" });'],
  ["gap: serial lines counted", "if (!rrIsStock(it) || rrIsSerial(it) || rrHasHu(l)) continue;\n    const missing", "if (!rrIsStock(it) || rrHasHu(l)) continue;\n    const missing"],
  ["gap: in transit counted as missing", " - (transit[rrS(l.id)] || 0));", ");"],
  ["staging: serial lines checked", "if (!rrIsStock(it) || rrIsSerial(it) || rrHasHu(l)) continue;\n    if (rrPicks(l).some(", "if (!rrIsStock(it) || rrHasHu(l)) continue;\n    if (rrPicks(l).some("],
  ["staging: cancelled requests count", 'rrS(r.status) !== "" && rrS(r.status) !== "Cancelled"', 'rrS(r.status) !== ""'],
  ["staging: never applied", "if (rrPicks(l).some((p) => rrS(p.location_id) !== rrS(stagingBin))) {", "if (false) {"],
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (base.split(from).length !== 2) {
    console.log("BROKEN mutant (anchor not found once): " + name);
    survived++;
    continue;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-rr-mut-"));
  fs.mkdirSync(path.join(dir, "code", "shared"), { recursive: true });
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "code", "shared", "iatr_reserve.js"), base.replace(from, to));
  fs.copyFileSync(TEST, path.join(dir, "test", "test_iatr_reserve.js"));
  const r = spawnSync(process.execPath, [path.join(dir, "test", "test_iatr_reserve.js")], { encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
