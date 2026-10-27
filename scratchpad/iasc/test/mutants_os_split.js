// node scratchpad/iasc/test/mutants_os_split.js [outDir] - each mutant of os_split.js must make test_os_split.js fail
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SRC = path.join(__dirname, "..", "code", "shared", "os_split.js");
const TEST = path.join(__dirname, "test_os_split.js");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "os-split-mut-"));
const base = fs.readFileSync(SRC, "utf8");
const MUTANTS = [
  ["serial not detected", "if (Number(it.serial_number_management) === 1) return \"SERIAL\";", ""],
  ["non-stock not detected", "if (it.stock_control === 0 || it.stock_control === \"0\") return \"NONSTOCK\";", ""],
  ["batch flag loose", "if (it.item_batch_management === 1) return", "if (Number(it.item_batch_management) === 1) return"],
  ["every batch is System", "return it.batch_number_genaration === \"According To System Settings\" ? \"SYSTEM\" : \"MANUAL\";", "return \"SYSTEM\";"],
  ["broken JSON read as no rows", "  } catch (e) {\n    return null;", "  } catch (e) {\n    return [];"],
  ["an object read as rows", "return Array.isArray(p) ? p : p === null ? [] : null;", "return Array.isArray(p) ? p : [p];"],
  ["qty not rounded", "return { os_qty: osQ8(x.os_qty),", "return { os_qty: parseFloat(x.os_qty) || 0,"],
  ["Manual keeps the group", "os_group: kind === \"SYSTEM\" ? osS(x.os_group) : \"\",", "os_group: osS(x.os_group),"],
  ["non-batch keeps the dates", "os_mfg_date: batch ? osDate(x.os_mfg_date) : \"\",", "os_mfg_date: osDate(x.os_mfg_date),"],
  ["timestamp dates stringified", "const osDate = (v) => (typeof v === \"number\" && isFinite(v) ? v : osS(v));", "const osDate = (v) => osS(v);"],
  ["unknown UOM = 0", "return conv ? parseFloat(conv.base_qty) || 0 : 1;", "return conv ? parseFloat(conv.base_qty) || 0 : 0;"],
  ["Manual grouping case-sensitive", "\"B\" + osS(row.os_batch_no).toLowerCase()", "\"B\" + osS(row.os_batch_no)"],
  ["base qty not converted", "g.base = osQ8(g.base + osQ8(r.os_qty * f));", "g.base = osQ8(g.base + r.os_qty);"],
  ["max rows off by one", "if (rows.length > OS_MAX_ROWS) return", "if (rows.length >= OS_MAX_ROWS) return"],
  ["one row allowed", "if (rows.length < 2) return", "if (rows.length < 1) return"],
  ["Draft checked as completion", "if (!ctx.completing) return res(\"\", osGroups(rows, kind, ctx.item, ctx.item_uom));", ""],
  ["serial allowed on Draft", "if (kind === \"SERIAL\") return res(", "if (kind === \"SERIAL\" && ctx.completing) return res("],
  ["zero qty allowed", "if (!(r.os_qty > 0)) return", "if (r.os_qty < 0) return"],
  ["any bin text allowed", "if (!osDigits(r.os_location_id)) return", "if (r.os_location_id === \"\") return"],
  ["any category allowed", "if (OS_CATEGORIES.indexOf(r.os_category) < 0) return", "if (r.os_category === \"\") return"],
  ["group 0 allowed", "!/^[1-9][0-9]?$/.test(r.os_group)", "!/^[0-9]+$/.test(r.os_group)"],
  ["Manual number not required", "if (kind === \"MANUAL\" && r.os_batch_no === \"\") return", "if (false) return"],
  ["total not checked", "if (Math.abs(total - want) > OS_EPS) return", "if (false) return"],
  ["total tolerance too wide", "if (Math.abs(total - want) > OS_EPS) return", "if (Math.abs(total - want) > 1e-6) return"],
  ["dates not compared", "String(rows[i].os_mfg_date) !== String(first.os_mfg_date) || String(rows[i].os_exp_date) !== String(first.os_exp_date)", "false"],
  ["expiry not compared", "String(rows[i].os_mfg_date) !== String(first.os_mfg_date) || String(rows[i].os_exp_date) !== String(first.os_exp_date)", "String(rows[i].os_mfg_date) !== String(first.os_mfg_date)"],
  ["Manual spelling not unified", "if (kind === \"MANUAL\") groups[g].rows.forEach((i) => (rows[i].os_batch_no = groups[g].batch_no));", ""],
  ["duplicates allowed", "if (seen[key] !== undefined) {", "if (false) {"],
  ["duplicate key without category", "+ \"|\" + rows[i].os_location_id + \"|\" + rows[i].os_category;", "+ \"|\" + rows[i].os_location_id;"],
  ["duplicate key without group", "const key = osGroupKey(rows[i], kind) + \"|\"", "const key = \"|\""],
  ["header not copied", "  if (!r) return own;", "  return own;"],
  ["non-batch header loses its batch fields", "const batch = kind !== \"PLAIN\";", "const batch = true;"],
  ["missing number allowed", "if (!nums[g]) return res(", "if (false) return res("],
  ["same number allowed", "if (twin < g) return res(", "if (false) return res("],
  ["rows not numbered", "outGroups.forEach((g) => g.rows.forEach((i) => (outRows[i].os_batch_no = g.batch_no)));", ""],
  ["refusal numbers the rows", "  const outRows = rows.map((r) => Object.assign({}, r));", "  const outRows = rows;\n  groups.forEach((g, i) => g.rows.forEach((k) => (rows[k].os_batch_no = nums[i])));"],
  ["Batch id case-sensitive", "map[r.os_batch_no.toLowerCase()]", "map[r.os_batch_no]"],
  ["non-batch inserts a blank Batch row", "batch_number: batch ? r.os_batch_no : \"-\",", "batch_number: batch ? r.os_batch_no : \"\","],
  ["non-batch loses the header dates", "manufacturing_date: batch ? r.os_mfg_date || null : h.manufacturing_date || null,", "manufacturing_date: batch ? r.os_mfg_date || null : null,"],
  ["Batch row qty in the item UOM", "initial_quantity: g.base,", "initial_quantity: g.qty,"],
  ["Batch row empty date as ''", "manufacturing_date: g.mfg || null,", "manufacturing_date: g.mfg,"],
  ["j: long ids lose precision", "return JSON.parse(t.replace(", "return JSON.parse(t); (t.replace("],
  ["merge: no key erases an unread split", "if (!has && o.edit && !stored) return stop(", "if (false) return stop("],
  ["merge: no key ignores the stored rows", "const given = has ? osParse(x.output_split) : kept;", "const given = has ? osParse(x.output_split) : [];"],
  ["merge: unreadable rows written as none", "if (given === null) return stop(", "if (given === null) return out(\"OK\", \"\", []); if (false) return stop("],
  ["merge: no cap", "if (given.length > OS_MAX_ROWS) return stop(", "if (false) return stop("],
  ["merge: mobile may move a split", "if (!has && given.length && (osS(x.issuing_operation_faci)", "if (false && (osS(x.issuing_operation_faci)"],
  ["merge: mobile guard on the desktop too", "if (!has && given.length && (osS(", "if (given.length && (osS("],
  ["merge: mobile bin not compared", " || osS(x.location_id) !== osS(stored.bin))) {", ")) {"],
  ["bins: plant not compared", "if (!b || osS(b.plant) !== osS(plant)) return", "if (!b) return"],
  ["bins: inactive allowed", "if (Number(b.active) !== 1) return", "if (false) return"],
  ["bins: storage location kept from the row", "os_storage_location_id: osS(by[r.os_location_id].sl) }", "os_storage_location_id: r.os_storage_location_id }"],
  ["completion: bins not checked", "  if (!bc.ok) return stop(bc.message);", ""],
  ["completion: checked as a draft", "item_uom: h.item_uom, completing: true });", "item_uom: h.item_uom, completing: false });"],
  ["completion: Manual numbered too", "const gen = kind === \"SYSTEM\";", "const gen = kind !== \"PLAIN\";"],
  ["completion: the group dates dropped", "manufacturing_date: g.mfg || null, expired_date: g.exp || null })) : [],", "manufacturing_date: null, expired_date: null })) : [],"],
  ["final: numbers in arrival order", "nums[Number(x.index)] = x.batch_number;", "nums.push(x.batch_number);"],
  ["final: refusal ignored", "  if (!as.ok) return Object.assign({}, base, { route: \"STOP\", message: as.message });", ""],
  ["receipts: any item's Batch row counts", ".filter((b) => b && osS(b.material_id) === osS(h.item_id));", ".filter((b) => !!b);"],
  // (exactly-one vs at-least-one per batch is an equivalent mutant: the row count equals the batch count)
];
let survived = 0;
MUTANTS.forEach(([name, from, to], i) => {
  if (base.indexOf(from) < 0) {
    console.log("BROKEN mutant (anchor not found): " + name);
    survived++;
    return;
  }
  const file = path.join(OUT, "m" + i + ".js");
  fs.writeFileSync(file, base.replace(from, to));
  const r = spawnSync("node", [TEST], { env: Object.assign({}, process.env, { OS_SPLIT: file }), encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + name);
  }
});
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
