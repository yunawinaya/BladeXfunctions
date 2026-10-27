// PO_LINE_IMPORT code bodies on crafted inputs (no DB).  node test/unit.js
"use strict";
const fs = require("fs");
const path = require("path");
const C = path.join(__dirname, "..", "code");
const strip = (t) => { const l = t.split("\n"); const at = l.findIndex((x) => /^const res = /.test(x)); return l.slice(0, at).join("\n"); };
const load = (file, names) => new Function(strip(fs.readFileSync(path.join(C, file), "utf8")) + "\nreturn { " + names.join(", ") + " };")();
const { importGuard } = load("guard.js", ["importGuard"]);
const { importResolve } = load("resolve.js", ["importResolve"]);
const { importRows } = load("rows.js", ["importRows"]);
let passes = 0, fails = 0;
const ok = (c, what, x) => { if (c) passes++; else { fails++; console.log("FAIL", what, x === undefined ? "" : JSON.stringify(x).slice(0, 600)); } };
const IN = (rows, o) => Object.assign({ rows, tenantId: "000000", organizationId: "9", supplierId: "77", plantId: "5" }, o || {});

// ------------------------------------------------------------------ guard
let g = importGuard(IN([{ "Item Code": "A1", Quantity: 5 }, { "item_code": "b2 ", "QTY": "1,250.5", "UOM": "box", "Unit Price": "2.5", "Discount": 10, "Discount Type": "percent",
  "Description": "x", "Remark 1": "r1", "Remark2": "r2", "Required Delivery Date": "20/10/2026" }, { "Item Code": "", Quantity: "" }, { "Item Code": "A1", Quantity: 3, Colour: "red" }]));
ok(g.route === "GO" && g.count === 3 && g.rows[1].qty === 1250.5 && g.rows[1].code === "b2" && g.rows[1].uom === "box" && g.rows[1].price === 2.5, "guard: headers + numbers", g);
ok(g.rows[1].discountType === "%" && g.rows[1].discount === 10 && g.rows[1].date === "2026-10-20" && g.rows[1].remark1 === "r1" && g.rows[1].remark2 === "r2", "guard: discount type, date, remarks", g.rows[1]);
ok(g.rows[0].n === 2 && g.rows[2].n === 5, "guard: Excel row numbers (blank row skipped, numbering kept)", g.rows.map((r) => r.n));
ok(JSON.parse(g.codesSql).map((x) => x.c).join() === "A1,b2" && /Colour/.test(g.message), "guard: distinct codes + unimported column named", [g.codesSql, g.message]);
g = importGuard(IN([{ "Item Code": "O'Brien \\ x", Quantity: 1 }]));
ok(g.codesSql === '[{"c":"O\'\'Brien \\\\\\\\ x"}]', "guard: codes escaped for the SQL literal", g.codesSql);
g = importGuard(IN([{ "Item Code": "A1", Quantity: 0 }, { "Item Code": "A2", Quantity: "x" }, { "Item Code": "A3" }, { Quantity: 2, UOM: "pc" }, { "Item Code": "A4", Quantity: 1, "Unit Price": -1 },
  { "Item Code": "A5", Quantity: 1, Discount: 5, "Discount Type": "half" }, { "Item Code": "A6", Quantity: 1, Discount: 120, "Discount Type": "%" }, { "Item Code": "A7", Quantity: 1, "Required Delivery Date": "31/02/2026" }]));
ok(g.route === "STOP" && g.code === "400" && g.errors.length === 8 && g.rows.length === 0, "guard: every bad row listed, nothing goes on", g.errors);
ok(g.errors.map((e) => e.row).join() === "2,3,4,5,6,7,8,9" && /Quantity must be a number above 0/.test(g.errors[0].message) && /Quantity is empty/.test(g.errors[2].message) && /Item Code is empty/.test(g.errors[3].message), "guard: messages and rows", g.errors);
ok(/Discount Type must be % or Amount/.test(g.errors[5].message) && /above 100%/.test(g.errors[6].message) && /not a date/.test(g.errors[7].message), "guard: discount type / % / date", g.errors.slice(5));
ok(importGuard(IN([{ Name: "x", Qty: 1 }])).message.indexOf("no Item Code column") >= 0, "guard: no Item Code column -> the template's columns");
ok(importGuard(IN(Array.from({ length: 2501 }, (_, i) => ({ "Item Code": "C" + i, Quantity: 1 })))).message.indexOf("2501 lines") >= 0, "guard: > 2,500 lines");
ok(importGuard(IN([], {})).message === "The file has no Item Code column. The template's columns are: Item Code, Quantity, UOM, Unit Price, Discount, Discount Type, Description, Remark 1, Remark 2, Required Delivery Date.", "guard: empty file");
ok(importGuard(IN([{ "Item Code": "A", Quantity: 1 }], { organizationId: "x" })).route === "STOP" && importGuard(IN([{ "Item Code": "A", Quantity: 1 }], { supplierId: "1 or 1" })).route === "STOP", "guard: keys digits only");
ok(importGuard(IN(JSON.stringify([{ "Item Code": "A", Quantity: 1 }]))).route === "GO", "guard: rows as JSON text");
const dates = [[46010, "2025-12-19"], ["2026-10-20", "2026-10-20"], ["2026/1/5", "2026-01-05"], ["5-1-2026", "2026-01-05"], ["5.1.2026", "2026-01-05"], ["1 Jan 2026", "2026-01-01"],
  ["01-Sep-2026", "2026-09-01"], ["3 September 2026", "2026-09-03"], ["Mar 7, 2026", "2026-03-07"], ["2026-10-20 00:00:00", "2026-10-20"], ["29/02/2024", "2024-02-29"]];
for (const [v, want] of dates) {
  const r = importGuard(IN([{ "Item Code": "A", Quantity: 1, "Delivery Date": v }]));
  ok(r.route === "GO" && r.rows[0].date === want, "guard date " + v, r.rows[0] || r.errors);
}
ok(importGuard(IN([{ "Item Code": "A", Quantity: 1, "Delivery Date": "29/02/2026" }])).route === "STOP", "guard: 29 Feb 2026 is not a date");

// ------------------------------------------------------------------ resolve
const conv = (o) => Object.assign({ id: "C" + Math.random().toString(36).slice(2, 6), alt_qty: 1, base_qty: 1, purchase_unit_price: 0, purchase_default_uom: 0, purchase_tax_percent: null,
  mat_purchase_tax_id: null, min_purchase_qty: 0, max_purchase_qty: 0 }, o);
const item = (o) => ({ j: JSON.stringify(Object.assign({ id: "1001", material_code: "A1", material_name: "Apple", material_desc: "apple desc", item_category: "IC", further_description: "fd",
  based_uom: "U1", mat_purchase_tax_id: null, is_active: 1, conv: [conv({ alt_uom_id: "U1", uom_name: "PCS" }), conv({ alt_uom_id: "U2", uom_name: "Box", base_qty: 12, purchase_default_uom: 1,
    purchase_unit_price: 30, mat_purchase_tax_id: "T9", purchase_tax_percent: 6, min_purchase_qty: 2, max_purchase_qty: 100 })], binds: [] }, o)) });
const G0 = (rows) => importGuard(IN(rows));
let r = importResolve(G0([{ "Item Code": "a1", Quantity: 4 }]), [item()]);
const L = r.lines[0].line;
ok(r.route === "GO" && L.item_id === "1001" && L.quantity_uom === "U2" && L.unit_price === 30 && L.tax_preference === "T9" && L.tax_percent === 6 && L.min_quantity === 2 && L.max_quantity === 100,
  "resolve: blank UOM -> the default purchase UOM row (as Batch Add)", L);
ok(L.item_desc === "apple desc" && L.item_name === "Apple" && L.further_description === "fd" && L.item_category_id === "IC" && !("alt_uom" in L) && JSON.parse(JSON.parse(r.altUomJson)["1001"]).length === 2 && !("uom_name" in JSON.parse(JSON.parse(r.altUomJson)["1001"])[0]), "resolve: item fields; alt_uom = the conversion rows, once per item", [L, r.altUomJson]);
ok(JSON.stringify(r.itemData[0]) === JSON.stringify({ item_id: "1001", unit_price: 30, line_index: 0, uom_id: "U2", tax_rate: "T9", tax_percent: 6, quantity: 4 }), "resolve: the price request", r.itemData[0]);
r = importResolve(G0([{ "Item Code": "A1", Quantity: 4, UOM: "pcs" }]), [item()]);
ok(r.lines[0].line.quantity_uom === "U1" && r.lines[0].line.unit_price === 0 && r.lines[0].line.tax_preference === null, "resolve: UOM by name (any case) -> that UOM's row", r.lines[0].line);
r = importResolve(G0([{ "Item Code": "A1", Quantity: 4 }]), [item({ conv: [conv({ alt_uom_id: "U1", uom_name: "PCS", purchase_unit_price: 1.5 }), conv({ alt_uom_id: "U3", uom_name: "Pack" })] })]);
ok(r.lines[0].line.quantity_uom === "U1" && r.lines[0].line.unit_price === 1.5, "resolve: no default purchase UOM -> the base UOM's row", r.lines[0].line);
r = importResolve(G0([{ "Item Code": "A1", Quantity: 4 }]), [item({ binds: [{ supplier_id: "66", item_description: "other" }, { supplier_id: "77", item_description: "" }, { supplier_id: "77", item_description: "our desc" }] })]);
ok(r.lines[0].line.item_desc === "our desc", "resolve: this supplier's bound description (first non-empty)", r.lines[0].line.item_desc);
r = importResolve(G0([{ "Item Code": "Z9", Quantity: 1 }, { "Item Code": "A1", Quantity: 1, UOM: "Crate" }, { "Item Code": "B1", Quantity: 1 }, { "Item Code": "D1", Quantity: 1 }, { "Item Code": "E1", Quantity: 1 }]),
  [item(), item({ id: "2001", material_code: "B1", is_active: 0 }), item({ id: "3001", material_code: "D1" }), item({ id: "3002", material_code: "D1" }), item({ id: "4001", material_code: "E1", conv: [conv({ alt_uom_id: "U8", uom_name: "x" })], based_uom: "U1" })]);
ok(r.route === "STOP" && r.errors.length === 5 && r.lines.length === 0, "resolve: every problem listed, nothing goes on", r.errors);
ok(/Z9 was not found/.test(r.errors[0].message) && /Crate is not a unit of item A1/.test(r.errors[1].message) && /B1 is inactive/.test(r.errors[2].message) && /matches 2 items/.test(r.errors[3].message) && /no purchase UOM/.test(r.errors[4].message), "resolve: messages", r.errors);
ok(r.errors[1].message === "UOM Crate is not a unit of item A1. Use its base UOM PCS (or Box)", "resolve: a wrong UOM names the base UOM, then the other units", r.errors[1].message);
r = importResolve(G0([{ "Item Code": "A1", Quantity: 1, UOM: "kg" }]), [item({ conv: [conv({ alt_uom_id: "U1", uom_name: "PCS" })] })]);
ok(r.errors[0].message === "UOM kg is not a unit of item A1. Use its base UOM PCS", "resolve: base UOM only", r.errors[0].message);
r = importResolve(G0([{ "Item Code": "A1", Quantity: 1, UOM: "kg" }]), [item({ based_uom: "U9", based_uom_name: "Each", conv: [conv({ alt_uom_id: "U2", uom_name: "Box" })] })]);
ok(r.errors[0].message === "UOM kg is not a unit of item A1. Use its base UOM Each (or Box)", "resolve: base UOM name from the item when its conversion rows lack it", r.errors[0].message);
r = importResolve(G0([{ "Item Code": "A1", Quantity: 1, UOM: "kg" }]), [item({ based_uom: "U9", conv: [conv({ alt_uom_id: "U2", uom_name: "Box" })] })]);
ok(r.errors[0].message === "UOM kg is not a unit of item A1. Its units: Box", "resolve: no base UOM name -> the item's units", r.errors[0].message);
r = importResolve(G0([{ "Item Code": "d1", Quantity: 1 }]), [item({ id: "3001", material_code: "d1" }), item({ id: "3002", material_code: "D1" })]);
ok(r.route === "GO" && r.lines[0].line.item_id === "3001", "resolve: an exact-case match settles two codes the database compares equal", r.lines[0] && r.lines[0].line.item_id);
r = importResolve(G0([{ "Item Code": "A1", Quantity: 1 }]), [item({ mat_purchase_tax_id: "H1" })]);
ok(r.lines[0].headerTax === 1, "resolve: item with a purchase tax of its own flagged");

// ------------------------------------------------------------------ rows
r = importResolve(G0([{ "Item Code": "A1", Quantity: 4 }, { "Item Code": "A1", Quantity: 6, "Unit Price": 7, Discount: 2, Description: "own", "Remark 1": "R", "Delivery Date": "2026-12-01" }]), [item({ mat_purchase_tax_id: "H1" })]);
let w = importRows(r, [{ item_id: "1001", line_index: 0, uom_id: "U2", unit_price: 28, tax_rate: "T9", tax_percent: 6, from_historical: 1, max_price: 40, min_price: 20, quantity: 4, min_qty: 2, max_qty: 100, discount: 1, discount_uom: "%" },
  { item_id: "1001", line_index: 1, uom_id: "U2", unit_price: 28, tax_rate: null, tax_percent: null, quantity: 6, discount: 1, discount_uom: "%" }]);
const rows = JSON.parse(w.rowsJson);
ok(rows.length === 2 && rows[0].unit_price === 28 && rows[0].quantity === 4 && rows[0].from_historical === 1 && rows[0].discount === 1 && rows[0].discount_uom === "%" && rows[0].tax_preference === "T9", "rows: the price answer as Batch Add takes it", rows[0]);
ok(rows[1].unit_price === 7 && rows[1].quantity === 6 && rows[1].discount === 2 && rows[1].discount_uom === "%" && rows[1].item_desc === "own" && rows[1].line_remark_1 === "R" && rows[1].po_expected_date === "2026-12-01", "rows: the file's own values on top", rows[1]);
ok(JSON.parse(w.taxOpenJson).join() === "1" && w.count === "2", "rows: Tax Rate stays open where the item has its own tax and the line no tax code", w.taxOpenJson);
w = importRows(r, []);
ok(JSON.parse(w.rowsJson)[0].unit_price === 30 && JSON.parse(w.rowsJson)[0].quantity === 4 && !("discount" in JSON.parse(w.rowsJson)[0]), "rows: no price answer -> the line as Batch Add starts it", JSON.parse(w.rowsJson)[0]);

console.log("po import unit tests:", passes, "passed,", fails, "failed");
process.exit(fails ? 1 : 0);
