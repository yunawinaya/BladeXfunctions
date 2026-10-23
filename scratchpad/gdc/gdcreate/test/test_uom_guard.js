// test_uom_guard.js: runs GOODS_DELIVERY's unit guard (code_node_GdUomGuard + code_node_GdUomCheck) from the patched repo JSON,
// placeholders filled as the platform fills them (JSON values). SQL rows are the shape sql_node_GdUomGuard returns (run on dev + prod 10-23).
const fs = require("fs");
const W = JSON.parse(fs.readFileSync(process.argv[2] || "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDheadWorkflow.json", "utf8"));
const find = (o, id) => {
  if (Array.isArray(o)) { for (const v of o) { const r = find(v, id); if (r) return r; } return null; }
  if (o && typeof o === "object") { if (o.id === id) return o; for (const v of Object.values(o)) { const r = find(v, id); if (r) return r; } }
  return null;
};
const code = (id) => find(W, id).data.script.code;
const fill = (src, vals) => src.replace(/\{\{(workflowparams|node):([A-Za-z0-9_.]+)\}\}/g, (m, kind, name) => {
  if (!(name in vals)) throw new Error("no value for " + m);
  return JSON.stringify(vals[name]);
});
const guard = (saveAs, allData) => new Function(fill(code("code_node_GdUomGuard"), { saveAs, allData }))();
const check = (allData, pageStatus, rows) => new Function(fill(code("code_node_GdUomCheck"), { allData, pageStatus, "sql_node_GdUomGuard.data": rows }))();

const NOODLE = "2113379350937214980", FISH = "2113378594486099976", SOAP = "9000000000000000001";
const PAKET = "2113378399719399443", CTN_UP = "2113378399719399459", CTN = "2113378399719399460", KG_UP = "2113378399719399432", KG = "2113378399719399433";
const line = (m, u, q, extra) => Object.assign({ material_id: m, gd_order_uom_id: u, gd_qty: q }, extra || {});
const rows = (stored, extra) => [
  { kind: "GD", k: stored || "", base_uom: "", stock_control: "", conv: "", name: "" },
  { kind: "ITEM", k: NOODLE, base_uom: PAKET, stock_control: "1", conv: PAKET + "," + CTN, name: "Instant Noodle VIT'S" },
  { kind: "ITEM", k: FISH, base_uom: KG, stock_control: "1", conv: KG, name: "Salted Fish" },
  { kind: "ITEM", k: SOAP, base_uom: CTN, stock_control: "0", conv: "", name: "Soap (non-stock)" },
  { kind: "UNIT", k: CTN_UP, base_uom: "", stock_control: "", conv: "", name: "箱CTN" },
  { kind: "UNIT", k: KG_UP, base_uom: "", stock_control: "", conv: "", name: "Kg" },
].concat(extra || []);

let fails = 0;
const t = (name, ok, got) => { console.log((ok ? "ok   " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(got))); if (!ok) fails += 1; };
let g;
g = guard("Created", { id: "123", table_gd: [line(NOODLE, CTN_UP, 1), line(FISH, KG_UP, 2)] });
t("guard: Created with two stock lines -> YES, both materials and units, the stored id", g.check === "YES" && g.materialIdsSql === NOODLE + "," + FISH && g.uomIdsSql === CTN_UP + "," + KG_UP && g.gdId === "123", g);
t("guard: Completed -> YES", guard("Completed", { table_gd: [line(NOODLE, CTN, 1)] }).check === "YES");
t("guard: Draft -> NO", guard("Draft", { table_gd: [line(NOODLE, CTN_UP, 1)] }).check === "NO");
t("guard: Cancelled -> NO", guard("Cancelled", { table_gd: [line(NOODLE, CTN_UP, 1)] }).check === "NO");
t("guard: a Picking Plan delivery -> NO", guard("Created", { is_select_picking: 1, table_gd: [line(NOODLE, CTN_UP, 1)] }).check === "NO");
t("guard: description-only lines only -> NO", guard("Created", { table_gd: [{ material_id: "", gd_qty: 1 }, { gd_qty: 2, material_name: "Delivery charge" }] }).check === "NO");
t("guard: every line at 0 -> NO", guard("Created", { table_gd: [line(NOODLE, CTN_UP, 0), line(FISH, KG_UP, "0.000")] }).check === "NO");
g = guard("Created", { table_gd: [{ item_bundle_id: "77", gd_qty: 1, children: [line(NOODLE, CTN_UP, 2)] }] });
t("guard: a bundle's items are read from its children", g.check === "YES" && g.materialIdsSql === NOODLE, g);
g = guard("Created", { table_gd: [{ material_id: FISH, gd_order_uom_id: "", good_delivery_uom_id: KG_UP, gd_qty: 1 }] });
t("guard: good_delivery_uom_id when gd_order_uom_id is empty (classic's own fallback)", g.uomIdsSql === KG_UP, g);
t("guard: a new delivery has gdId 0", guard("Created", { table_gd: [line(NOODLE, CTN, 1)] }).gdId === "0");

let c;
c = check({ table_gd: [line(NOODLE, CTN_UP, 1, { material_name: "Instant Noodle 唯一面 VIT'S" })] }, "Add", rows());
t("check: the 128671 noodle (箱CTN, item knows 箱Ctn) -> refused, line + unit named",
  c.refuse === "YES" && c.message.startsWith("Not saved: line 1 (Instant Noodle 唯一面 VIT'S) is in 箱CTN. That unit is not one of the item's units"), c);
t("check: the base unit -> passes", check({ table_gd: [line(NOODLE, PAKET, 6)] }, "Add", rows()).refuse === "NO");
t("check: a conversion unit -> passes", check({ table_gd: [line(NOODLE, CTN, 1)] }, "Add", rows()).refuse === "NO");
t("check: a non-stock item in any unit -> passes", check({ table_gd: [line(SOAP, KG_UP, 1)] }, "Add", rows()).refuse === "NO");
t("check: an item the read did not find -> left to the save", check({ table_gd: [line("9000000000000000999", KG_UP, 1)] }, "Add", rows()).refuse === "NO");
t("check: Edit of a stored Created GD -> never refused (Picking / Packing completion)", check({ id: "5", table_gd: [line(NOODLE, CTN_UP, 1)] }, "Edit", rows("Created")).refuse === "NO");
t("check: Edit of a stored Draft -> refused", check({ id: "5", table_gd: [line(NOODLE, CTN_UP, 1)] }, "Edit", rows("Draft")).refuse === "YES");
t("check: Edit of a GD not found -> refused", check({ id: "5", table_gd: [line(NOODLE, CTN_UP, 1)] }, "Edit", rows("")).refuse === "YES");
t("check: SO_AUTO_GD (no pageStatus) -> checked", check({ table_gd: [line(FISH, KG_UP, 1)] }, "", rows()).refuse === "YES");
c = check({ table_gd: [1, 2, 3, 4, 5].map((i) => line(FISH, KG_UP, i, { material_name: "Fish " + i })) }, "Add", rows());
t("check: 5 bad lines -> 3 named, 'and 2 more line(s)', plural wording",
  c.refuse === "YES" && (c.message.match(/line \d \(Fish/g) || []).length === 3 && c.message.includes("; and 2 more line(s). Those units are"), c);
c = check({ table_gd: [line(NOODLE, PAKET, 1), { item_bundle_id: "77", gd_qty: 1, children: [line(NOODLE, PAKET, 1), line(FISH, KG_UP, 1)] }] }, "Add", rows());
t("check: a bundle item -> 'line 2.2', the item's name from the read", c.refuse === "YES" && c.message.startsWith("Not saved: line 2.2 (Salted Fish) is in Kg."), c);
c = check({ table_gd: [line(NOODLE, "2113378399719399999", 1)] }, "Add", rows());
t("check: a unit the read did not name -> 'unit <id>'", c.message.startsWith("Not saved: line 1 (Instant Noodle VIT'S) is in unit 2113378399719399999."), c);
c = check({ table_gd: [line(NOODLE, CTN_UP, 1)] }, "Add", rows()[0]);
t("check: a one-row SQL answer (an object, not a list) -> nothing found, passes", c.refuse === "NO", c);
t("check: zero-quantity bad line -> passes", check({ table_gd: [line(NOODLE, CTN_UP, 0)] }, "Add", rows()).refuse === "NO");
console.log(fails ? fails + " FAILED" : "ALL PASSED");
process.exit(fails ? 1 : 0);
