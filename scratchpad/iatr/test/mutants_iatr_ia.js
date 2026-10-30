// node scratchpad/iatr/test/mutants_iatr_ia.js - each mutant of code/shared/iatr_ia.js must make test_iatr_ia.js fail ("all" = every copy)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const FILE = path.join(__dirname, "..", "code", "shared", "iatr_ia.js");
const base = fs.readFileSync(FILE, "utf8");
const MUTANTS = [
  ["STATUS without the staging bin", "{ stale: stale, sl: iatrS(r.sl), bin: iatrS(r.bin) }", "{ stale: stale, sl: iatrS(r.sl) }"],
  // the user, 10-29: a request whose IA was deleted can still be cancelled, by its own organisation; nothing else works without the IA
  ["an orphan never cancelled", "transfer request's organisation.\");\n    return cancel(n);", "transfer request's organisation.\");\n    return answer(400, \"no\");"],
  ["an orphan's organisation not checked", "if (!iatrS(n.org) || iatrId(n.org) !== iatrId(x.org)) return answer(400", "if (false) return answer(400"],
  ["an orphan's organisation may be blank", "if (!iatrS(n.org) || iatrId(n.org) !== iatrId(x.org))", "if (iatrS(n.org) && iatrId(n.org) !== iatrId(x.org))"],
  ["an orphan of another IA cancelled", " || iatrId(n.source) !== iatrId(x.iaId)) return answer(400", ") return answer(400"],
  ["an orphan's dispatched request cancelled", "    return cancel(n);\n  }\n  // the member read", "    return cancel(Object.assign({}, n, { status: \"Requested\" }));\n  }\n  // the member read"],
  ["a non-member goes on", "if (!(Number(x.member) > 0)) return answer(400", "if (Number(x.member) === 7) return answer(400"],
  ["only a member through one department goes on", "if (!(Number(x.member) > 0)) return answer(400", "if (Number(x.member) !== 1) return answer(400"],
  ["an IA of another organisation goes on", "if (iatrId(ia.org) !== iatrId(x.org)) return answer(400", "if (false) return answer(400"],
  ["any IA status requests", 'if (status !== "Draft") return answer(400, "Only a saved Draft', 'if (false) return answer(400, "Only a saved Draft'],
  ["material holds ignored", "if (IATR_HOLDS_OK.indexOf(iatrS(ia.hold).toUpperCase()) < 0)", "if (false)"],
  ["hold statuses case-sensitive", "IATR_HOLDS_OK.indexOf(iatrS(ia.hold).toUpperCase())", "IATR_HOLDS_OK.indexOf(iatrS(ia.hold))"],
  ["no output quantity taken", "if (!(iatrQ8(ia.item_qty) > 0))", "if (false)"],
  ["the screen's IA not compared", "if (iatrS(x.expectFp) !== iatrIaFp(iatrBasis(ia), x.iaLines)) {", "if (false) {"],
  ["an invalid demand goes on", "  if (!d.ok) return answer(400, d.message);\n", ""],
  ["a live request ignored", "if (reqs.live) return answer(200,", "if (false) return answer(200,"],
  ["a received request ignored", "if (reqs.received) {\n    return answer(409,", "if (false) {\n    return answer(409,"],
  ["the bin's storage location not checked", " || iatrId(bin.sl) !== iatrId(sl.id)", ""],
  ["the bin's plant not checked", " || iatrId(bin.plant) !== iatrId(ia.plant)", ""],
  ["an inactive bin taken", " || Number(bin.active) !== 1) {", ") {"],
  ["the chosen bin not the one read", "if (!bin || iatrId(bin.id) !== iatrId(x.binId) ||", "if (!bin ||"],
  ["the storage location's plant not checked", " || iatrId(sl.plant) !== iatrId(ia.plant)", ""],
  ["an inactive storage location taken", " || Number(sl.active) !== 1) {", ") {"],
  ["no required date needed", "if (!iatrDate(x.requiredDate))", "if (false)"],
  ["no number rule needed", "if (!iatrS(x.rule))", "if (false)"],
  ["a replacement not linked", 'replacesId: reqs.cancelled ? iatrS(reqs.cancelled.id) : ""', 'replacesId: ""'],
  ["IA1: line order matters", "  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));\n  const basis", "  const basis"],
  ["IA1: Required not hashed", ", opt(l.required_qty)]);", "]);"],
  ["IA1: the header basis not hashed", "const basis = [iatrId(h.plant), iatrId(h.itemId), opt(h.itemQty), opt(h.plannedQty), iatrS(h.mode), iatrId(h.bomId)];", "const basis = [];"],
  ["IA1: a blank Required is 0", 'const opt = (v) => (iatrBlank(v) ? "" : iatrQ8(v).toFixed(8));', "const opt = (v) => iatrQ8(v).toFixed(8);"],
  ["IA1: the planned output not hashed", " opt(h.plannedQty),", ""],
  ["newest by text only", "x.length !== y.length ? y.length - x.length : ", ""],
  ["Processing not live", 'const IATR_LIVE = ["Requested", "In Progress", "Processing"];', 'const IATR_LIVE = ["Requested", "In Progress"];'],
  ["lines: the destination swapped", "storage_location_id: iatrId(c.storage),\n      location_id: iatrId(c.bin)", "storage_location_id: iatrId(c.bin),\n      location_id: iatrId(c.storage)"],
  ["lines: the requirement not fixed-decimal", "requested_qty: iatrQ8(d.requested_qty).toFixed(8)", "requested_qty: d.requested_qty"],
  ["lines: the item's name before the IA line's", "item_name: iatrS(src.item_name) || iatrS(it.material_name)", "item_name: iatrS(it.material_name) || iatrS(src.item_name)"],
  ["lines: no unit options", "uom_options: (c.uoms || {})[d.item_selection] || []", "uom_options: []"],
  ["lines: no source line", "source_ia_line_id: d.source_ia_line_id, source_ref_key", 'source_ia_line_id: "", source_ref_key'],
  ["REFRESH: a dispatched request refreshed", 'if (iatrS(n.status) !== "Requested") return answer(400, "Only a Requested transfer request can be refreshed', 'if (false) return answer(400, "Only a Requested transfer request can be refreshed'],
  ["open jobs ignored", "if (Number(n.openJobs) > 0 || Number(n.openTransit) > 0)", "if (Number(n.openTransit) > 0)", "all"],
  ["open In Transit rows ignored", "if (Number(n.openJobs) > 0 || Number(n.openTransit) > 0)", "if (Number(n.openJobs) > 0)", "all"],
  ["REFRESH: always already matching", 'if (same.ok || same.code === "IATR_NOT_FULL" || same.code.indexOf("IATR_PICK") === 0) {', "if (true) {"],
  ["REFRESH: never already matching", 'if (same.ok || same.code === "IATR_NOT_FULL" || same.code.indexOf("IATR_PICK") === 0) {', "if (false) {"],
  ["REFRESH: unpicked lines not 'already'", 'same.ok || same.code === "IATR_NOT_FULL" ||', "same.ok ||"],
  ["REFRESH: the revision kept", "rev: (Number(n.rev) || 0) + 1", "rev: Number(n.rev) || 0"],
  ["REFRESH: the request's destination ignored", "    const dest = destOf(n);\n", "    const dest = destOf(x);\n"],
  ["CANCEL: a dispatched request cancelled here", 'if (iatrS(n.status) !== "Requested") {\n      return answer(400, "Only a Requested transfer request can be cancelled here', 'if (false) {\n      return answer(400, "Only a Requested transfer request can be cancelled here'],
  ["CANCEL: a cancelled request cancelled again", 'if (iatrS(n.status) === "Cancelled") return answer(200', 'if (false) return answer(200'],
  ["another IA's request taken", "iatrId(n.source) !== iatrId(ia.id)", "false", "all"],
  ["an ordinary transfer taken", "iatrS(n.purpose) !== IATR_PURPOSE ||", "", "all"],
  ["STATUS: never stale", "!d.ok || fpWith(d, destOf(r)) !== iatrS(r.fp)", "false"],
  // (not a mutant: dropping !d.ok in STATUS is equivalent - an invalid demand hashes zero lines, never a stored request's fingerprint)
  ["STATUS: may create after a receipt", 'can_create: reqs.live || reqs.received ? "NO" : "YES"', 'can_create: reqs.live ? "NO" : "YES"'],
  ["STATUS: the received not shown first", "const r = reqs.live || reqs.received || reqs.latest;", "const r = reqs.live || reqs.latest;"],
  ["win: the lease ignored", "const live = claims.filter((c) => now - Date.parse(iatrS(c.started_at).replace(\" \", \"T\") + \"Z\") < IATR_LEASE_MS);", "const live = claims;"],
  ["win: claim numbers as text", "Number(iatrS(a.name).slice(6)) - Number(iatrS(b.name).slice(6))", "(iatrS(a.name) < iatrS(b.name) ? -1 : 1)"],
  ["win: the IA not re-checked", 'if (op !== "CANCEL" && iatrS(s0.status) !== "Draft")', "if (false)"],
  ["win: a new request not noticed", 'if (op === "CREATE" && (reqs.live || reqs.received))', "if (false)"],
  ["win: the request not re-checked", 'if (!n || iatrS(n.status) !== "Requested" || Number(s0.openJobs) > 0)', "if (!n)"],
  ["log: the stored log dropped", "return JSON.stringify(log.concat([entry]));", "return JSON.stringify([entry]);"],
  ["date: no calendar check", ' && new Date(ms).toISOString().slice(0, 10) === t', ""],
];
let survived = 0;
for (const [name, from, to, mode] of MUTANTS) {
  const n = base.split(from).length - 1;
  if (n < 1 || (mode !== "all" && n !== 1)) {
    console.log("BROKEN mutant (anchor found " + n + " times): " + name);
    survived++;
    continue;
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatr-iam-")), "iatr_ia.js");
  fs.writeFileSync(f, mode === "all" ? base.split(from).join(to) : base.replace(from, () => to));
  const r = spawnSync(process.execPath, [path.join(__dirname, "test_iatr_ia.js")], { env: Object.assign({}, process.env, { IATR_IA: f }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  } else console.log("killed   " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
