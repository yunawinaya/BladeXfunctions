// Mutation check of test_prepare.js: each mutant is the built IDA_V2_PREPARE.json with one deliberate defect in a code node; the suite must
// fail on every one. usage: node scratchpad/idav2/test/prepare/mutants.js   (writes only into a temporary folder)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const L = require("./lib.js");

const SRC = path.join(L.OUT, "IDA_V2_PREPARE.json");
const MUTANTS = [
  ["ENGINE_I parent_trx_no null", "parent_trx_no: \"\",\n      inventory_category: idaCategory", "parent_trx_no: null,\n      inventory_category: idaCategory"],
  ["alloc base_qty = the line-UOM share", "share_qty: share, base_qty: baseQty", "share_qty: share, base_qty: share"],
  ["a non-stock AUTO row inserts", "kind: \"AUTO\", insert: stock", "kind: \"AUTO\", insert: true"],
  ["TYPED rows grouped by the raw text", "const gk = s(l.item_selection) + \"|\" + idaBatchKey(l.batch_number);", "const gk = s(l.item_selection) + \"|\" + idaPlanText(l.batch_number);"],
  ["no TYPED-held check", "&& held[idaBatchKey(l.batch_number)]) {", "&& false) {"],
  ["no lock check", "if (!mine(owner) || !mine(hdr) || !key || s(owner.lock_ref) !== key) return fail", "if (false) return fail"],
  ["unlock before the lock check", "  base.unlockOk = 1;\n  if (own) own.locked = 1;\n  if (s(req.action)", "  if (own) own.locked = 1;\n  if (s(req.action)"],
  ["job line_count = receipts", "line_count: Number(p.moveCount) || 0", "line_count: Number(p.movementCountR) || 0"],
  ["no handling-unit screen", "if (idaHasHu(hdr)) return \"handling units\";", ""],
  ["R category from the receipt", "inventory_category: \"Unrestricted\", location_id: s(r.location_id)", "inventory_category: idaS(r.inventory_category), location_id: s(r.location_id)"],
  ["a 401 result accepted", "results.filter((r) => s(r && r.code) !== \"200\")[0]", "results.filter((r) => s(r && r.code) === \"500\")[0]"],
  ["R doc_date dropped", "batch_id: null, unit_price: 0, doc_date: idaPlanDate(r.doc_date)", "batch_id: null, unit_price: 0, doc_date: null"],
  ["line order by id only", "if (x !== y) return x < y ? -1 : 1;", ""],
  ["the unlinked IDA not released", "idaList(e.unlockRows), null, e.link)", "[], null, e.link)"],
  ["op 2 PLAN result count unchecked", "if (results.length !== count) return no(", "if (false) return no("],
  ["TYPED initial_quantity = the first line only", "typedBase[row.key] += baseQty;", "typedBase[row.key] = typedBase[row.key] || baseQty;"],
  ["LABELS pick number 0-based", "pick: String(k + 1)", "pick: String(k)"],
  ["the link not written with FAILED", "const linked = link && s(link.correlation_id) ?", "const linked = false ?"],
  ["the classic gate's refusal ignored", "if (s(verdict.status) === \"Failed\") return fail(\"IDA_INVALID\"", "if (false) return fail(\"IDA_INVALID\""],
  ["the storage locations not merged", "for (const l of lines) if (at[idaS(l.id)]) l.storage_location_id = at[idaS(l.id)];", ""],
  ["code_validate's search_batches not fed", "count: b.length, data: b }", "count: b.length, data: [] }"],
];

const doc = fs.readFileSync(SRC, "utf8");
const dir = fs.mkdtempSync(path.join(process.env.IDA_MUTANT_DIR || os.tmpdir(), "ida-prepare-mutants-"));
let bad = 0;
for (const [name, from, to] of MUTANTS) {
  const enc = (t) => JSON.stringify(t).slice(1, -1);
  const n = doc.split(enc(from)).length - 1;
  if (n < 1) {
    console.log("MISSING  " + name + ": the text to mutate is not in the built JSON");
    bad++;
    continue;
  }
  fs.writeFileSync(path.join(dir, "IDA_V2_PREPARE.json"), doc.split(enc(from)).join(enc(to)));
  const r = spawnSync(process.execPath, [path.join(__dirname, "test_prepare.js")], { env: Object.assign({}, process.env, { IDA_PREPARE_OUT: dir }), encoding: "utf8" });
  const fails = (r.stdout.match(/^FAIL /gm) || []).length;
  const killed = r.status !== 0;
  if (!killed) bad++;
  console.log((killed ? "killed   " : "SURVIVED ") + name + " (" + n + " place" + (n === 1 ? "" : "s") + ", " + fails + " failing checks" + (r.status > 1 ? ", crash" : "") + ")");
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(bad ? bad + " mutant(s) not killed" : "all " + MUTANTS.length + " mutants killed");
process.exit(bad ? 1 : 0);
