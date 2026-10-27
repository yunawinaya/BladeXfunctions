// node scratchpad/iasc/test/test_os_split.js - unit tests of scratchpad/iasc/code/shared/os_split.js (IA output split, plan 10-27)
const path = require("path");
const O = require(process.env.OS_SPLIT || path.join(__dirname, "..", "code", "shared", "os_split.js"));

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want));
  }
};
const yes = (label, v) => eq(label, !!v, true);

const PAKET = "501";
const CTN = "502";
const item = (extra) => Object.assign({ id: "9001", based_uom: PAKET, serial_number_management: 0, stock_control: 1, item_batch_management: 1,
  batch_number_genaration: "According To System Settings", table_uom_conversion: [{ alt_uom_id: CTN, base_qty: 12 }, { alt_uom_id: PAKET, base_qty: 1 }] }, extra || {});
const SYS = item();
const MAN = item({ batch_number_genaration: "Manual Input" });
const PLAIN = item({ item_batch_management: 0 });
const row = (qty, bin, extra) => Object.assign({ os_qty: qty, os_storage_location_id: "71", os_location_id: bin, os_category: "Blocked", os_group: 1,
  os_batch_no: "", os_mfg_date: "2026-10-27", os_exp_date: "2028-10-27" }, extra || {});
const ctx = (kind, qty, extra) => Object.assign({ kind: kind, item_qty: qty, item: kind === "MANUAL" ? MAN : kind === "PLAIN" ? PLAIN : SYS, item_uom: PAKET, completing: true }, extra || {});

// ---- osKind: the classic's own rules (code_batch_decide: item_batch_management === 1, the System Settings text)
eq("kind: System Settings batch", O.osKind(SYS), "SYSTEM");
eq("kind: Manual Input batch", O.osKind(MAN), "MANUAL");
eq("kind: any other generation text is Manual (as code_batch_decide: not auto)", O.osKind(item({ batch_number_genaration: "" })), "MANUAL");
eq("kind: non-batch", O.osKind(PLAIN), "PLAIN");
eq("kind: serial wins over batch", O.osKind(item({ serial_number_management: 1 })), "SERIAL");
eq("kind: not stock-controlled", O.osKind(item({ stock_control: 0 })), "NONSTOCK");
eq("kind: item_batch_management '1' (string) is not batch, as the classic's ===", O.osKind(item({ item_batch_management: "1" })), "PLAIN");
eq("kind: no item", O.osKind(null), "PLAIN");

// ---- osParse: array, its JSON text, nothing; null = unreadable
eq("parse: array kept", O.osParse([{ a: 1 }]), [{ a: 1 }]);
eq("parse: JSON text", O.osParse('[{"os_qty":5}]'), [{ os_qty: 5 }]);
eq("parse: empty text", O.osParse(""), []);
eq("parse: null", O.osParse(null), []);
eq("parse: undefined", O.osParse(undefined), []);
eq("parse: JSON null", O.osParse("null"), []);
eq("parse: broken JSON", O.osParse("[{"), null);
eq("parse: an object is not rows", O.osParse('{"os_qty":5}'), null);
eq("parse: a number is not rows", O.osParse(5), null);

// ---- osNorm: q8 qty, trimmed text, the fields this kind uses
eq("norm: System keeps group, number, dates", O.osNorm([row(" 500.123456789 ", " 81 ", { os_group: 2, os_batch_no: " B1 " })], "SYSTEM"),
  [{ os_qty: 500.12345679, os_storage_location_id: "71", os_location_id: "81", os_category: "Blocked", os_group: "2", os_batch_no: "B1", os_mfg_date: "2026-10-27", os_exp_date: "2028-10-27" }]);
eq("norm: Manual drops the group", O.osNorm([row(5, "81", { os_group: 3, os_batch_no: "LOT-9" })], "MANUAL")[0].os_group, "");
eq("norm: non-batch drops group, number, dates", O.osNorm([row(5, "81", { os_batch_no: "X" })], "PLAIN"),
  [{ os_qty: 5, os_storage_location_id: "71", os_location_id: "81", os_category: "Blocked", os_group: "", os_batch_no: "", os_mfg_date: "", os_exp_date: "" }]);
eq("norm: blank / junk rows become empty rows (counted, refused by the check)", O.osNorm([null, "x"], "PLAIN").map((r) => r.os_qty), [0, 0]);
eq("norm: a null date stays empty", O.osNorm([row(5, "81", { os_mfg_date: null })], "SYSTEM")[0].os_mfg_date, "");
eq("norm: a timestamp date stays a number (the widget's value, passed on as given)", O.osNorm([row(5, "81", { os_mfg_date: 1761436800000 })], "SYSTEM")[0].os_mfg_date, 1761436800000);
eq("norm: a stored date text kept", O.osNorm([row(5, "81", { os_exp_date: " 2028-10-26 00:00:00.000 " })], "MANUAL")[0].os_exp_date, "2028-10-26 00:00:00.000");

// ---- osBaseFactor: ADD_INVENTORY's rule (table_uom_conversion alt_uom_id === uom -> base_qty, else 1)
eq("factor: CTN = 12", O.osBaseFactor(SYS, CTN), 12);
eq("factor: base UOM = 1", O.osBaseFactor(SYS, PAKET), 1);
eq("factor: unknown UOM = 1 (ADD keeps the qty)", O.osBaseFactor(SYS, "999"), 1);
eq("factor: no conversions", O.osBaseFactor(item({ table_uom_conversion: null }), CTN), 1);

// ---- osGroups: first appearance order, rows, qty, base qty, the batch's number and dates
const sys3 = O.osNorm([row(500, "81"), row(300, "82"), row(36, "83", { os_group: 2, os_category: "Unrestricted", os_mfg_date: "2026-10-20", os_exp_date: "2028-10-20" })], "SYSTEM");
eq("groups: System 3 rows / 2 groups", O.osGroups(sys3, "SYSTEM", SYS, PAKET), [
  { key: "G1", label: "group 1", rows: [0, 1], qty: 800, base: 800, batch_no: "", mfg: "2026-10-27", exp: "2028-10-27" },
  { key: "G2", label: "group 2", rows: [2], qty: 36, base: 36, batch_no: "", mfg: "2026-10-20", exp: "2028-10-20" }]);
eq("groups: base qty in the base UOM (CTN x 12), summed per row as ADD would", O.osGroups(O.osNorm([row(1.5, "81"), row(0.25, "82")], "SYSTEM"), "SYSTEM", SYS, CTN).map((g) => [g.qty, g.base]),
  [[1.75, 21]]);
const man = O.osNorm([row(5, "81", { os_batch_no: "Lot-A" }), row(3, "82", { os_batch_no: " lot-a " }), row(2, "83", { os_batch_no: "LOT-B" })], "MANUAL");
eq("groups: Manual by number, case-insensitive, the first row's spelling", O.osGroups(man, "MANUAL", MAN, PAKET).map((g) => [g.key, g.batch_no, g.rows, g.qty, g.label]),
  [["Blot-a", "Lot-A", [0, 1], 8, "batch Lot-A"], ["Blot-b", "LOT-B", [2], 2, "batch LOT-B"]]);
eq("groups: non-batch has none", O.osGroups(O.osNorm([row(5, "81"), row(3, "82")], "PLAIN"), "PLAIN", PLAIN, PAKET), []);

// ---- osCheck at completion: every refusal, the passing shape
const chk = (rows, kind, qty, extra) => O.osCheck(rows, ctx(kind, qty, extra));
const msg = (rows, kind, qty, extra) => chk(rows, kind, qty, extra).message;
const ok3 = chk([row(500, "81"), row(300, "82"), row(36, "83", { os_group: 2, os_category: "Unrestricted" })], "SYSTEM", 836);
yes("check: System 3 rows / 2 groups passes", ok3.ok && ok3.message === "" && ok3.rows.length === 3 && ok3.groups.length === 2);
eq("check: no rows = not split, passes with nothing", chk([], "SYSTEM", 836), { ok: true, message: "", split: false, rows: [], groups: [] });
yes("check: a split says split", ok3.split === true);
eq("check: serial output", msg([row(5, "81"), row(5, "82")], "SERIAL", 10, { item: item({ serial_number_management: 1 }) }),
  "Serial-numbered items cannot be split across bins: switch Split receipt off.");
eq("check: not stock-controlled", msg([row(5, "81"), row(5, "82")], "NONSTOCK", 10, { item: item({ stock_control: 0 }) }),
  "This item is not stock-controlled: there is no receipt to split. Switch Split receipt off.");
eq("check: one row", msg([row(5, "81")], "SYSTEM", 5), "A split receipt needs at least 2 rows: add a row or switch Split receipt off.");
const many = (k) => Array.from({ length: k }, (_, i) => row(1, String(100 + i)));
yes("check: 20 rows pass", chk(many(20), "SYSTEM", 20).ok);
eq("check: 21 rows", msg(many(21), "SYSTEM", 21), "A split receipt can have at most 20 rows.");
eq("check: a row without qty", msg([row(5, "81"), row(0, "82")], "SYSTEM", 5), "Output row 2: enter a quantity above 0.");
eq("check: a negative qty", msg([row(6, "81"), row(-1, "82")], "SYSTEM", 5), "Output row 2: enter a quantity above 0.");
eq("check: a row without bin", msg([row(5, "81"), row(5, "")], "SYSTEM", 10), "Output row 2: choose a bin location.");
eq("check: a bin id that is not an id", msg([row(5, "81"), row(5, "abc")], "SYSTEM", 10), "Output row 2: choose a bin location.");
eq("check: a row without category", msg([row(5, "81", { os_category: "" }), row(5, "82")], "SYSTEM", 10), "Output row 1: choose Unrestricted or Blocked.");
eq("check: another category", msg([row(5, "81"), row(5, "82", { os_category: "Reserved" })], "SYSTEM", 10), "Output row 2: choose Unrestricted or Blocked.");
eq("check: System row without group", msg([row(5, "81"), row(5, "82", { os_group: "" })], "SYSTEM", 10),
  "Output row 2: enter a group number (rows with the same group share one batch).");
eq("check: System group not a whole number", msg([row(5, "81"), row(5, "82", { os_group: 1.5 })], "SYSTEM", 10),
  "Output row 2: enter a group number (rows with the same group share one batch).");
eq("check: System group 0", msg([row(5, "81"), row(5, "82", { os_group: 0 })], "SYSTEM", 10),
  "Output row 2: enter a group number (rows with the same group share one batch).");
eq("check: Manual row without number", msg([row(5, "81", { os_batch_no: "L1" }), row(5, "82")], "MANUAL", 10), "Output row 2: enter a batch number.");
eq("check: total below the output", msg([row(5, "81"), row(4, "82")], "SYSTEM", 10), "The split total 9 is not the output quantity 10: adjust the rows.");
eq("check: total above the output", msg([row(5, "81"), row(6, "82")], "SYSTEM", 10), "The split total 11 is not the output quantity 10: adjust the rows.");
yes("check: q8 sums (0.1 + 0.2 = 0.3)", chk([row(0.1, "81"), row(0.2, "82")], "SYSTEM", 0.3).ok);
yes("check: 4e-9 off passes (q8 tolerance)", chk([row("0.33333333", "81"), row("0.66666667", "82")], "SYSTEM", "1.000000004").ok);
eq("check: 1e-8 off refused", msg([row("0.33333333", "81"), row("0.66666666", "82")], "SYSTEM", 1), "The split total 0.99999999 is not the output quantity 1: adjust the rows.");
eq("check: one System group with two dates", msg([row(5, "81"), row(5, "82", { os_exp_date: "2029-01-01" })], "SYSTEM", 10),
  "Output rows 1 and 2 are one batch (group 1) with different dates: give a batch one manufacturing and one expiry date.");
eq("check: one Manual batch with two dates", msg([row(5, "81", { os_batch_no: "L1" }), row(5, "82", { os_batch_no: "l1", os_mfg_date: "" })], "MANUAL", 10),
  "Output rows 1 and 2 are one batch (batch L1) with different dates: give a batch one manufacturing and one expiry date.");
yes("check: one group, the same timestamp dates", chk([row(5, "81", { os_mfg_date: 1761436800000 }), row(5, "82", { os_mfg_date: 1761436800000 })], "SYSTEM", 10).ok);
eq("check: one group, a timestamp and a text date differ", msg([row(5, "81", { os_mfg_date: 1761436800000 }), row(5, "82", { os_mfg_date: "1761436800001" })], "SYSTEM", 10),
  "Output rows 1 and 2 are one batch (group 1) with different dates: give a batch one manufacturing and one expiry date.");
yes("check: different groups may have different dates", chk([row(5, "81"), row(5, "82", { os_group: 2, os_exp_date: "2029-01-01" })], "SYSTEM", 10).ok);
eq("check: same group, bin and category twice", msg([row(5, "81"), row(3, "82"), row(2, "81")], "SYSTEM", 10),
  "Output rows 1 and 3 put the same batch into the same bin and category: merge them into one row.");
yes("check: same group and bin, other category passes", chk([row(5, "81"), row(5, "81", { os_category: "Unrestricted" })], "SYSTEM", 10).ok);
yes("check: same bin and category, other group passes", chk([row(5, "81"), row(5, "81", { os_group: 2 })], "SYSTEM", 10).ok);
eq("check: non-batch same bin and category twice", msg([row(5, "81"), row(5, "81")], "PLAIN", 10),
  "Output rows 1 and 2 go to the same bin and category: merge them into one row.");
yes("check: non-batch ignores group and dates", chk([row(5, "81", { os_group: "" }), row(5, "82", { os_exp_date: "x" })], "PLAIN", 10).ok);
eq("check: Manual rows carry their batch's first spelling", chk([row(5, "81", { os_batch_no: "Lot-A" }), row(5, "82", { os_batch_no: "LOT-a" })], "MANUAL", 10).rows.map((r) => r.os_batch_no),
  ["Lot-A", "Lot-A"]);
eq("check: the first failing row is named (row order)", msg([row(5, "81"), row(0, ""), row(5, "")], "SYSTEM", 10), "Output row 2: enter a quantity above 0.");

// ---- osCheck while not completing (Draft / Created): rows normalised, nothing refused but the cap
yes("draft: one row passes", chk([row(5, "81")], "SYSTEM", 5, { completing: false }).ok);
yes("draft: an unfinished row passes", chk([row(5, "81"), row("", "")], "SYSTEM", 5, { completing: false }).ok);
eq("draft: 21 rows refused", chk(many(21), "SYSTEM", 21, { completing: false }).message, "A split receipt can have at most 20 rows.");
eq("draft: serial refused (it can never complete)", chk([row(5, "81"), row(5, "82")], "SERIAL", 10, { completing: false, item: item({ serial_number_management: 1 }) }).message,
  "Serial-numbered items cannot be split across bins: switch Split receipt off.");

// ---- osHeader: row 1 into the header's single fields (single-value readers keep working), item_qty untouched
const hdr = { storage_location_id: "70", location_id: "80", inventory_category: "Unrestricted", batch_no: "OLD", manufacturing_date: "2026-01-01", expired_date: "2027-01-01", item_qty: 836 };
eq("header: a split copies row 1", O.osHeader(ok3.rows, hdr), { storage_location_id: "71", location_id: "81", inventory_category: "Blocked", batch_no: "",
  manufacturing_date: "2026-10-27", expired_date: "2028-10-27" });
eq("header: no split keeps the header's own values", O.osHeader([], hdr), { storage_location_id: "70", location_id: "80", inventory_category: "Unrestricted", batch_no: "OLD",
  manufacturing_date: "2026-01-01", expired_date: "2027-01-01" });
eq("header: a non-batch split keeps the header's batch fields", O.osHeader(chk([row(5, "81"), row(5, "82")], "PLAIN", 10).rows, hdr, "PLAIN"),
  { storage_location_id: "71", location_id: "81", inventory_category: "Blocked", batch_no: "OLD", manufacturing_date: "2026-01-01", expired_date: "2027-01-01" });

// ---- osAssign: System numbers per group into the rows (must differ)
const a = O.osAssign(ok3.rows, ok3.groups, ["1056-022-0004", "1056-022-0005"]);
eq("assign: the group's number on each of its rows", a.rows.map((r) => r.os_batch_no), ["1056-022-0004", "1056-022-0004", "1056-022-0005"]);
eq("assign: the groups carry their numbers", a.groups.map((g) => g.batch_no), ["1056-022-0004", "1056-022-0005"]);
yes("assign: ok", a.ok && a.message === "");
eq("assign: a number missing", O.osAssign(ok3.rows, ok3.groups, ["1056-022-0004", ""]).message, "Could not generate a batch number for group 2. Check the Batch Number Configuration for this item.");
eq("assign: the same number twice", O.osAssign(ok3.rows, ok3.groups, ["1056-022-0004", "1056-022-0004"]).message,
  "Batch numbering gave group 1 and group 2 the same number 1056-022-0004: save again.");
eq("assign: rows untouched on a refusal", O.osAssign(ok3.rows, ok3.groups, ["X", "X"]).rows.map((r) => r.os_batch_no), ["", "", ""]);

// ---- osReceipts: one ADD_INVENTORY call per row, its group's Batch row id
const rc = O.osReceipts(a.rows, a.groups, "SYSTEM", { "1056-022-0004": "7001", "1056-022-0005": "7002" });
eq("receipts: per row, in table order", rc, [
  { row: 1, location_id: "81", inventory_category: "Blocked", quantity: 500, batch_number: "1056-022-0004", batch_id: "7001", manufacturing_date: "2026-10-27", expired_date: "2028-10-27" },
  { row: 2, location_id: "82", inventory_category: "Blocked", quantity: 300, batch_number: "1056-022-0004", batch_id: "7001", manufacturing_date: "2026-10-27", expired_date: "2028-10-27" },
  { row: 3, location_id: "83", inventory_category: "Unrestricted", quantity: 36, batch_number: "1056-022-0005", batch_id: "7002", manufacturing_date: "2026-10-27", expired_date: "2028-10-27" }]);
eq("receipts: the Batch id is looked up case-insensitively (Manual)", O.osReceipts(chk([row(5, "81", { os_batch_no: "Lot-A" }), row(5, "82", { os_batch_no: "lot-a" })], "MANUAL", 10).rows,
  null, "MANUAL", { "lot-a": "7003" }).map((r) => r.batch_id), ["7003", "7003"]);
eq("receipts: a batch without its Batch row id -> null (the caller refuses)", O.osReceipts(a.rows, a.groups, "SYSTEM", { "1056-022-0004": "7001" })[2].batch_id, null);
const hdates = { manufacturing_date: "2026-05-05", expired_date: "2027-05-05" };
eq("receipts: non-batch = no Batch row ('-'), the header's dates", O.osReceipts(chk([row(5, "81"), row(5, "82")], "PLAIN", 10).rows, [], "PLAIN", {}, hdates), [
  { row: 1, location_id: "81", inventory_category: "Blocked", quantity: 5, batch_number: "-", batch_id: null, manufacturing_date: "2026-05-05", expired_date: "2027-05-05" },
  { row: 2, location_id: "82", inventory_category: "Blocked", quantity: 5, batch_number: "-", batch_id: null, manufacturing_date: "2026-05-05", expired_date: "2027-05-05" }]);

// ---- osBatchRows: one Batch row per group (ADD_INVENTORY add_node_F9KqZLfd columns), initial_quantity = the group's base qty
const br = O.osBatchRows(a.groups, { item_id: "9001", issuing_operation_faci: "60", organization_id: "50", remarks: "r1", remarks_2: null, remarks_3: "" }, "IA-0001");
eq("batch rows: one per group, the 11 columns", br, [
  { batch_number: "1056-022-0004", material_id: "9001", initial_quantity: 800, transaction_no: "IA-0001", plant_id: "60", organization_id: "50", remark: "r1", remark2: "", remark3: "",
    manufacturing_date: "2026-10-27", expired_date: "2028-10-27" },
  { batch_number: "1056-022-0005", material_id: "9001", initial_quantity: 36, transaction_no: "IA-0001", plant_id: "60", organization_id: "50", remark: "r1", remark2: "", remark3: "",
    manufacturing_date: "2026-10-27", expired_date: "2028-10-27" }]);
const ctnGroups = O.osAssign(O.osNorm([row(1.5, "81"), row(0.25, "82")], "SYSTEM"), O.osGroups(O.osNorm([row(1.5, "81"), row(0.25, "82")], "SYSTEM"), "SYSTEM", SYS, CTN), ["B9"]).groups;
eq("batch rows: initial_quantity in the base UOM (1.75 CTN = 21 Paket)", O.osBatchRows(ctnGroups, {}, "T").map((b) => b.initial_quantity), [21]);
eq("batch rows: empty dates are null (as ADD's workflow params)", O.osBatchRows([{ batch_no: "B", base: 1, mfg: "", exp: "" }], {}, "T")[0].manufacturing_date, null);
eq("batch rows: the 11 columns in ADD_INVENTORY's order", O.OS_BATCH_COLS, ["batch_number", "material_id", "initial_quantity", "transaction_no", "plant_id", "organization_id",
  "remark", "remark2", "remark3", "manufacturing_date", "expired_date"]);

// ---- osSum: the client's summary line
eq("sum: q8 of the rows", O.osSum([{ os_qty: 0.1 }, { os_qty: 0.2 }, { os_qty: "x" }]), 0.3);

// ---- osJ: a SQL row's j column; long numbers kept as text
eq("j: text", O.osJ([{ j: '{"a":1}' }]), { a: 1 });
eq("j: object", O.osJ({ j: { a: 2 } }), { a: 2 });
eq("j: a 19-digit id stays exact", O.osJ([{ j: '{"id":2114932554966052865,"n":[2114932554966052866]}' }]), { id: "2114932554966052865", n: ["2114932554966052866"] });
eq("j: none", O.osJ(null), null);
eq("j: broken", O.osJ([{ j: "{" }]), null);

// ---- osMerge (IA_SAVE, every save): the payload's rows, else (mobile: no key) the stored ones; the mobile guard
const A = (extra) => Object.assign({ id: "1", issuing_operation_faci: "60", item_id: "9001", location_id: "81" }, extra || {});
const ST = (rows, extra) => Object.assign({ output_split: rows, plant: "60", item_id: "9001", bin: "81" }, extra || {});
const two = [row(5, "81"), row(5, "82")];
let mg = O.osMerge(A({ output_split: two }), null, { edit: false, tenantId: "711077" });
eq("merge: the payload's rows, normalised, binIds, tenant", [mg.route, mg.split, mg.output_split.length, mg.output_split[0].os_qty, mg.binIds, mg.tenantId, mg.count],
  ["OK", "YES", 2, 5, "81,82", "711077", "2"]);
mg = O.osMerge(A({ output_split: [] }), ST(two), { edit: true, tenantId: "711077" });
eq("merge: an empty payload clears a stored split (the switch turned off)", [mg.route, mg.split, mg.output_split, mg.binIds], ["OK", "NO", [], "0"]);
mg = O.osMerge(A(), ST(two), { edit: true, tenantId: "711077" });
eq("merge: no key (mobile) keeps the stored rows", [mg.route, mg.split, mg.output_split.map((r) => r.os_location_id)], ["OK", "YES", ["81", "82"]]);
mg = O.osMerge(A(), ST(JSON.stringify(two)), { edit: true });
eq("merge: stored rows as JSON text", mg.output_split.length, 2);
mg = O.osMerge(A(), ST(null), { edit: true });
eq("merge: no key, nothing stored = no split", [mg.route, mg.split], ["OK", "NO"]);
mg = O.osMerge(A(), null, { edit: false });
eq("merge: no key on an Add (mobile) = no split", [mg.route, mg.split], ["OK", "NO"]);
eq("merge: no key on an Edit whose stored row was not read: refused (never erase a split)", O.osMerge(A(), null, { edit: true }).message,
  "The stored output split could not be read: open the Item Assembly again and save.");
eq("merge: unreadable payload rows", O.osMerge(A({ output_split: "[{" }), null, {}).message, "The output split could not be read: open the Item Assembly again and save.");
eq("merge: 21 rows refused at any save", O.osMerge(A({ output_split: many(21) }), null, {}).message, "A split receipt can have at most 20 rows.");
for (const [what, extra] of [["plant", { issuing_operation_faci: "61" }], ["item", { item_id: "9002" }], ["bin", { location_id: "83" }]]) {
  eq("merge: mobile (no key) changing a stored split's " + what + ": refused", O.osMerge(A(extra), ST(two), { edit: true }).message,
    "This Item Assembly's output is split across bins: change its plant, item or bin on the desktop.");
  yes("merge: the desktop (key sent) may change the " + what, O.osMerge(A(Object.assign({ output_split: two }, extra)), ST(two), { edit: true }).route === "OK");
}
yes("merge: mobile changing the plant of an IA with no stored split: fine", O.osMerge(A({ issuing_operation_faci: "61" }), ST([]), { edit: true }).route === "OK");
eq("merge: a refusal writes no rows", O.osMerge(A({ output_split: "x" }), null, {}).output_split, []);

// ---- osBinCheck (a completion): every row's bin a live bin of the IA's plant; its storage location taken from the bin
const BINS = [{ id: "81", plant: "60", sl: "71", active: 1 }, { id: "82", plant: "60", sl: "72", active: 1 }, { id: "83", plant: "61", sl: "73", active: 1 },
  { id: "84", plant: "60", sl: "71", active: 0 }];
const bc = O.osBinCheck(O.osNorm([row(5, "81", { os_storage_location_id: "99" }), row(5, "82")], "SYSTEM"), BINS, "60");
eq("bins: ok, the storage location from the bin", [bc.ok, bc.rows.map((r) => r.os_storage_location_id)], [true, ["71", "72"]]);
eq("bins: another plant's bin", O.osBinCheck(O.osNorm([row(5, "81"), row(5, "83")], "SYSTEM"), BINS, "60").message,
  "Output row 2: its bin location is not a bin of this plant: choose it again.");
eq("bins: a bin not read (deleted / unknown)", O.osBinCheck(O.osNorm([row(5, "85"), row(5, "81")], "SYSTEM"), BINS, "60").message,
  "Output row 1: its bin location is not a bin of this plant: choose it again.");
eq("bins: an inactive bin", O.osBinCheck(O.osNorm([row(5, "81"), row(5, "84")], "SYSTEM"), BINS, "60").message, "Output row 2: its bin location is not active: choose another.");

// ---- osCompletion (code_node_OScheck): the rows checked for the item, the bins, the System groups to number
const HDR = { item_id: "9001", item_qty: 836, item_uom: PAKET, issuing_operation_faci: "60", item_assembly_date: "2026-10-27" };
const merged = (rows) => O.osMerge(A({ output_split: rows }), null, {});
const cp = O.osCompletion(merged([row(500, "81"), row(300, "82"), row(36, "81", { os_group: 2, os_category: "Unrestricted", os_mfg_date: "2026-10-20" })]), HDR, [SYS], { bins: BINS }, "77");
eq("completion: System split ok, numbering due, a cache key per run", [cp.route, cp.kind, cp.split, cp.gen, cp.output_split.length, cp.groups.length, /^77_\d+_[a-z0-9]+$/.test(cp.cacheKey)],
  ["OK", "SYSTEM", "YES", "YES", 3, 2, true]);
eq("completion: the groups to number (label, dates, the IA date)", cp.genGroups, [
  { index: 0, label: "group 1", item_id: "9001", document_date: "2026-10-27", manufacturing_date: "2026-10-27", expired_date: "2028-10-27" },
  { index: 1, label: "group 2", item_id: "9001", document_date: "2026-10-27", manufacturing_date: "2026-10-20", expired_date: "2028-10-27" }]);
eq("completion: no split = nothing to do", O.osCompletion(merged([]), HDR, [SYS], null, "77"),
  { route: "OK", message: "", kind: "", split: "NO", output_split: [], groups: [], gen: "NO", genGroups: [], cacheKey: "" });
const cm = O.osCompletion(merged([row(500, "81", { os_batch_no: "L1" }), row(336, "82", { os_batch_no: "l1" })]), HDR, [MAN], { bins: BINS }, "77");
eq("completion: Manual = no numbering, the first spelling", [cm.route, cm.kind, cm.gen, cm.output_split.map((r) => r.os_batch_no), cm.cacheKey], ["OK", "MANUAL", "NO", ["L1", "L1"], ""]);
eq("completion: a refused check = STOP with its message", O.osCompletion(merged([row(500, "81")]), HDR, [SYS], { bins: BINS }, "77").message,
  "A split receipt needs at least 2 rows: add a row or switch Split receipt off.");
eq("completion: a refused bin = STOP", O.osCompletion(merged([row(500, "81"), row(336, "83")]), HDR, [SYS], { bins: BINS }, "77").route, "STOP");
eq("completion: the item is found by the IA's item id", O.osCompletion(merged([row(5, "81"), row(5, "82")]), Object.assign({}, HDR, { item_qty: 10 }), [item({ id: "1" }), PLAIN],
  { bins: BINS }, "77").kind, "PLAIN");

// ---- osFinal (code_node_OSfinal): the generated numbers onto the groups (System), else the rows as checked
const fin = O.osFinal(cp, [{ index: 1, batch_number: "B-0002" }, { index: 0, batch_number: "B-0001" }]);
eq("final: numbers by group index", [fin.route, fin.output_split.map((r) => r.os_batch_no), fin.groups.map((g) => g.batch_no)], ["OK", ["B-0001", "B-0001", "B-0002"], ["B-0001", "B-0002"]]);
eq("final: numbers as cache text", O.osFinal(cp, JSON.stringify([{ index: 0, batch_number: "B-1" }, { index: 1, batch_number: "B-2" }])).groups.map((g) => g.batch_no), ["B-1", "B-2"]);
eq("final: a number missing", O.osFinal(cp, [{ index: 0, batch_number: "B-0001" }]).message,
  "Could not generate a batch number for group 2. Check the Batch Number Configuration for this item.");
eq("final: no numbers at all", O.osFinal(cp, null).route, "STOP");
eq("final: Manual keeps its rows", O.osFinal(cm, null).output_split.map((r) => r.os_batch_no), ["L1", "L1"]);
eq("final: no split", [O.osFinal(O.osCompletion(merged([]), HDR, [SYS], null, ""), null).split, O.osFinal(null, null).output_split], ["NO", []]);

// ---- osReceiptPlan (code_node_OSreceipts): the Batch rows read back (one per batch, this item), the receipts with their ids
const READ = { rows: [{ id: "7001", batch_number: "B-0001", material_id: "9001" }, { id: "7002", batch_number: "B-0002", material_id: "9001" }] };
let rp = O.osReceiptPlan(fin, { needBatch: "YES" }, READ, HDR);
eq("receipt plan: ok, one per row, the batch ids", [rp.route, rp.n, rp.receipts.map((r) => [r.row, r.batch_id, r.batch_number, r.quantity])],
  ["OK", "3", [[1, "7001", "B-0001", 500], [2, "7001", "B-0001", 300], [3, "7002", "B-0002", 36]]]);
rp = O.osReceiptPlan(fin, { needBatch: "YES" }, { rows: [READ.rows[0]] }, HDR);
eq("receipt plan: a batch not read back = STOP 0/n", [rp.route, rp.marker, rp.message], ["STOP", "0/3",
  "The output batches could not be created (group 2): no output was received. This Item Assembly needs review."]);
rp = O.osReceiptPlan(fin, { needBatch: "YES" }, { rows: READ.rows.concat([{ id: "7009", batch_number: "B-0002", material_id: "9001" }]) }, HDR);
eq("receipt plan: a batch read back twice = STOP", rp.route, "STOP");
rp = O.osReceiptPlan(fin, { needBatch: "YES" }, { rows: [READ.rows[0], { id: "7002", batch_number: "B-0002", material_id: "9999" }] }, HDR);
eq("receipt plan: another item's Batch row does not count", rp.route, "STOP");
rp = O.osReceiptPlan(fin, { needBatch: "YES" }, null, HDR);
eq("receipt plan: nothing read back = STOP", rp.route, "STOP");
const pf = O.osFinal(O.osCompletion(merged([row(5, "81"), row(5, "82")]), Object.assign({}, HDR, { item_qty: 10, manufacturing_date: "M", expired_date: "E" }), [PLAIN], { bins: BINS }, ""), null);
rp = O.osReceiptPlan(pf, { needBatch: "NO" }, null, Object.assign({}, HDR, { manufacturing_date: "M", expired_date: "E" }));
eq("receipt plan: non-batch = no Batch rows, '-', the header's dates", [rp.route, rp.receipts.map((r) => [r.batch_number, r.batch_id, r.manufacturing_date])],
  ["OK", [["-", null, "M"], ["-", null, "M"]]]);

console.log((fails ? "FAILED " : "") + "os_split: " + (n - fails) + "/" + n + " passed");
process.exit(fails ? 1 : 0);
