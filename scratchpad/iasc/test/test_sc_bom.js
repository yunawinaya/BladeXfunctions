// node scratchpad/iasc/test/test_sc_bom.js - unit tests of scratchpad/iasc/code/shared/sc_bom.js (CONTRACT.md section 5)
const path = require("path");
const B = require(process.env.SC_BOM || path.join(__dirname, "..", "code", "shared", "sc_bom.js"));

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

const EA = "100";
const CTN = "200";
const BOXU = "300";
const item = (id, extra) => Object.assign({ id: id, material_name: "N" + id, material_desc: "D" + id, based_uom: EA,
  serial_number_management: 0, stock_control: 1, table_uom_conversion: [] }, extra || {});
const line = (code, qty, extra) => Object.assign({ bom_material_code: code, sub_material_qty: String(qty), sub_material_qty_uom: EA,
  sub_material_wastage: 0, consume_type: "USE", bom_type: "standard", ref_bom_id: null }, extra || {});
const bom = (id, parent, base, lines, extra) => Object.assign({ id: id, parent_material_code: parent, parent_mat_bom_version: "V1",
  parent_mat_base_quantity: String(base), parent_mat_base_uom: EA, parent_mat_is_default: 0, is_active: 1,
  subform_sub_material: lines }, extra || {});
const world = (boms, items, opts) => {
  const o = opts || {};
  const calls = { boms: [], items: [] };
  return {
    calls: calls,
    io: {
      readBoms: async (ids) => {
        calls.boms.push(ids.slice());
        if (o.failBoms) throw new Error("read failed");
        return boms.filter((b) => ids.indexOf(b.parent_material_code) >= 0);
      },
      readItems: async (ids) => {
        calls.items.push(ids.slice());
        if (o.failItems) throw new Error("read failed");
        return items.filter((i) => ids.indexOf(i.id) >= 0 && (o.dropItem || "") !== i.id);
      },
    },
  };
};
const fgOf = (items, id) => items.filter((i) => i.id === id)[0];
const run = (w, items, input) => B.scResolve(Object.assign({ mode: "STANDARD", itemUomId: EA, outputQty: 1, expand: [],
  preparedAt: "2026-10-20T00:00:00Z", preparedBy: "t" }, input, { fg: fgOf(items, input.itemId) }), w.io);
const qtys = (res) => (res.rows || []).map((r) => [r.item_selection, r.quantity_uom, r.requested_qty]);

// the contract's section 7 structures
const ITEMS = [item("1"), item("2"), item("3"), item("4"), item("5"), item("6"), item("7", { serial_number_management: 1 }),
  item("8", { stock_control: 0 }), item("9")];
// 1 BOX (unit base): FRAME(2) 1 + SCREW(4) 4; FRAME BOM: PANEL(3) 2
const UNIT = [bom("10", "1", 1, [line("2", 1), line("4", 4)]), bom("20", "2", 1, [line("3", 2)])];
// 5 BOX (base 10): FRAME 20 + SCREW 40; FRAME base 2: PANEL 6
const BASE = [bom("10", "1", 10, [line("2", 20), line("4", 40)]), bom("20", "2", 2, [line("3", 6)])];

(async () => {
  // ---------------------------------------------------------------- scPickBom
  eq("pick: default wins", B.scPickBom([bom("a", "1", 1, [], { parent_mat_bom_version: "V3" }),
    bom("b", "1", 1, [], { parent_mat_bom_version: "V1", parent_mat_is_default: 1 })]).id, "b");
  eq("pick: highest V", B.scPickBom([bom("a", "1", 1, [], { parent_mat_bom_version: "V2" }),
    bom("b", "1", 1, [], { parent_mat_bom_version: "V10" }), bom("c", "1", 1, [], { parent_mat_bom_version: "" })]).id, "b");
  eq("pick: none", B.scPickBom([]), null);

  // ---------------------------------------------------------------- STANDARD = today's explode
  let w = world(UNIT, ITEMS);
  let r = await run(w, ITEMS, { itemId: "1" });
  yes("std unit ok", r.ok);
  eq("std unit rows", qtys(r), [["2", EA, 1], ["4", EA, 4]]);
  eq("std unit keys", r.rows.map((x) => x.key), ["2|" + EA + "|1", "4|" + EA + "|1"]);
  eq("std snapshot head", [r.snapshot.v, r.snapshot.mode, r.snapshot.itemId, r.snapshot.root.bomId, r.snapshot.expand], [1, "STANDARD", "1", "10", []]);
  eq("std name/desc from item", [r.rows[0].item_name, r.rows[0].item_desc], ["N2", "D2"]);
  eq("std never reads child BOMs", w.calls.boms.length, 1);
  w = world(BASE, ITEMS);
  r = await run(w, ITEMS, { itemId: "1", outputQty: 5 });
  eq("std base 10 x5: Frame 10 / Screw 20", qtys(r), [["2", EA, 10], ["4", EA, 20]]);
  w = world([bom("10", "1", 1, [line("4", 1), line("4", 2)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1" });
  eq("std duplicates stay separate rows", r.rows.map((x) => [x.key, x.requested_qty]), [["4|" + EA + "|1", 1], ["4|" + EA + "|2", 2]]);
  w = world([bom("10", "1", 1, [line("2", 1, { sub_material_name: "Bom name", sub_material_remark: "rk" })])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1" });
  eq("std BOM-row name and remark first", [r.rows[0].item_name, r.rows[0].item_remark], ["Bom name", "rk"]);

  // ---------------------------------------------------------------- FLAT
  w = world(UNIT, ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  yes("flat unit ok", r.ok);
  eq("flat unit: Panel 2 / Screw 4", qtys(r), [["3", EA, 2], ["4", EA, 4]]);
  eq("flat keys aggregate by item+uom", r.rows.map((x) => x.key), ["3|" + EA, "4|" + EA]);
  eq("flat panel path", r.snapshot.rows[0].paths[0].boms.concat(r.snapshot.rows[0].paths[0].items), ["10", "20", "2", "3"]);
  eq("flat snapshot expand", r.snapshot.expand, ["2"]);
  w = world(BASE, ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"], outputQty: 5 });
  eq("flat base 10/2 x5: Panel 30 / Screw 20", qtys(r), [["3", EA, 30], ["4", EA, 20]]);
  w = world(BASE, ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: [], outputQty: 5 });
  eq("flat with no tick = Tree inputs", qtys(r), [["2", EA, 10], ["4", EA, 20]]);
  // wastage compounds per level: Frame 1 x 1.1, Panel 2 x 1.05 per frame
  w = world([bom("10", "1", 1, [line("2", 1, { sub_material_wastage: 10 })]), bom("20", "2", 1, [line("3", 2, { sub_material_wastage: 5 })])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("flat wastage compounds", qtys(r), [["3", EA, 2.31]]);
  // aggregation of a screw at two levels
  w = world([bom("10", "1", 1, [line("2", 1), line("4", 4)]), bom("20", "2", 1, [line("3", 2), line("4", 2)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"], outputQty: 3 });
  eq("flat merges the same item+uom", qtys(r), [["3", EA, 6], ["4", EA, 18]]);
  eq("flat merged row keeps both paths", r.snapshot.rows[1].paths.length, 2);
  // same item in another UOM stays separate
  const ITEMS_U = ITEMS.map((i) => (i.id === "4" ? item("4", { table_uom_conversion: [{ alt_uom_id: BOXU, alt_qty: 1, base_qty: 100, base_uom_id: EA }] }) : i));
  w = world([bom("10", "1", 1, [line("2", 1), line("4", 4)]), bom("20", "2", 1, [line("4", 1, { sub_material_qty_uom: BOXU })])], ITEMS_U);
  r = await run(w, ITEMS_U, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("flat different UOMs not merged", qtys(r), [["4", BOXU, 1], ["4", EA, 4]]);
  // UOM conversion row UOM -> child base UOM (1 CTN = 12 EA; child base 6 EA)
  const ITEMS_C = ITEMS.map((i) => (i.id === "2" ? item("2", { table_uom_conversion: [{ alt_uom_id: CTN, alt_qty: 1, base_qty: 12, base_uom_id: EA }] }) : i));
  w = world([bom("10", "1", 1, [line("2", 1, { sub_material_qty_uom: CTN })]), bom("20", "2", 6, [line("3", 3)])], ITEMS_C);
  r = await run(w, ITEMS_C, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("flat converts CTN to the child base", qtys(r), [["3", EA, 6]]);
  const ITEMS_C2 = ITEMS.map((i) => (i.id === "2" ? item("2", { table_uom_conversion: [{ alt_uom_id: CTN, alt_qty: 2, base_qty: 24, base_uom_id: EA }] }) : i));
  w = world([bom("10", "1", 1, [line("2", 1, { sub_material_qty_uom: CTN })]), bom("20", "2", 6, [line("3", 3)])], ITEMS_C2);
  r = await run(w, ITEMS_C2, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("flat conversion uses base_qty / alt_qty", qtys(r), [["3", EA, 6]]);
  w = world([bom("10", "1", 1, [line("2", 1, { sub_material_qty_uom: CTN })]), bom("20", "2", 6, [line("3", 3)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("flat missing conversion stops", [r.ok, r.code], [false, "SC_NO_CONVERSION"]);
  yes("missing conversion message names the item", /N2/.test(r.message || ""));
  // ref_bom_id picks that BOM among the item's own BOMs
  w = world([bom("10", "1", 1, [line("2", 1, { bom_type: "reference", ref_bom_id: "21" })]),
    bom("20", "2", 1, [line("3", 2)], { parent_mat_is_default: 1 }), bom("21", "2", 1, [line("5", 7)], { parent_mat_bom_version: "V2" })], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("flat honours ref_bom_id", qtys(r), [["5", EA, 7]]);
  w = world([bom("10", "1", 1, [line("2", 1, { bom_type: "reference", ref_bom_id: "99" })]), bom("20", "2", 1, [line("3", 2)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("flat ref to a missing BOM stops", r.code, "SC_REF_BOM_MISSING");

  // ---------------------------------------------------------------- serial, non-stock, REF
  w = world([bom("10", "1", 1, [line("7", 0.5)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", outputQty: 3 });
  eq("serial rounds up", qtys(r), [["7", EA, 2]]);
  w = world([bom("10", "1", 1, [line("7", 0.14)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", outputQty: 50 });
  eq("serial rounds up after q8 (50 x 0.14 = 7.000000000000001 stays 7)", qtys(r), [["7", EA, 7]]);
  w = world([bom("10", "1", 1, [line("8", 1), line("4", 1)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1" });
  eq("non-stock flagged", r.rows.map((x) => [x.item_selection, x.nonStock]), [["8", 1], ["4", 0]]);
  w = world([bom("10", "1", 1, [line("2", 1, { consume_type: "REF" }), line("4", 1)]), bom("20", "2", 1, [line("3", 2)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("REF rows dropped and never expanded", qtys(r), [["4", EA, 1]]);
  eq("REF recorded", r.snapshot.dropped.map((d) => [d.itemId, d.why]), [["2", "REF"]]);

  // ---------------------------------------------------------------- guards
  w = world([], ITEMS);
  r = await run(w, ITEMS, { itemId: "1" });
  eq("root without BOM", r.code, "SC_NO_BOM");
  w = world([bom("10", "1", 1, [])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1" });
  eq("root BOM empty", r.code, "SC_BOM_EMPTY");
  w = world([bom("10", "1", 1, [line("2", 1, { consume_type: "REF" })])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1" });
  eq("root BOM with only REF rows", r.code, "SC_BOM_EMPTY");
  w = world([bom("10", "1", 1, [line("2", 1), line("4", 1)]), bom("20", "2", 1, [line("3", 1, { consume_type: "REF" })])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("ticked item whose BOM has only REF rows", r.code, "SC_BOM_EMPTY");
  r = await run(world([bom("10", "1", 1, [line("2", 1), line("4", 1)]), bom("20", "2", 1, [line("3", 1, { consume_type: "REF" })])], ITEMS), ITEMS,
    { itemId: "1", mode: "FLAT", expand: [] });
  eq("tree: a REF-only BOM is not expandable", r.tree.filter((t) => t.itemId === "2")[0].expandable, false);
  w = world([bom("10", "1", 0, [line("2", 1)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1" });
  eq("base 0", r.code, "SC_BASE_ZERO");
  w = world([bom("10", "1", 1, [line("2", 1)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("ticked item without BOM", r.code, "SC_EXPAND_NOT_ALLOWED");
  w = world([bom("10", "1", 1, [line("2", 1)]), bom("20", "2", 1, [])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"] });
  eq("ticked item with an empty BOM", r.code, "SC_BOM_EMPTY");
  w = world([bom("10", "1", 1, [line("2", 1)]), bom("20", "2", 1, [line("5", 1)]), bom("50", "5", 1, [line("2", 1)])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2", "5"] });
  eq("cycle", r.code, "SC_CYCLE");
  yes("cycle message shows the path", /N2/.test(r.message || "") && /N5/.test(r.message || ""));
  const chain = [];
  const CH_ITEMS = [];
  for (let i = 1; i <= 9; i++) {
    CH_ITEMS.push(item("c" + i));
    if (i < 9) chain.push(bom("b" + i, "c" + i, 1, [line("c" + (i + 1), 1)]));
  }
  w = world(chain, CH_ITEMS);
  r = await B.scResolve({ mode: "FLAT", itemId: "c1", itemUomId: EA, outputQty: 1, expand: ["c2", "c3", "c4", "c5", "c6", "c7", "c8"],
    fg: CH_ITEMS[0], preparedAt: "", preparedBy: "" }, w.io);
  eq("depth over 6", r.code, "SC_TOO_DEEP");
  r = await B.scResolve({ mode: "FLAT", itemId: "c1", itemUomId: EA, outputQty: 1, expand: ["c2", "c3", "c4", "c5", "c6"],
    fg: CH_ITEMS[0], preparedAt: "", preparedBy: "" }, world(chain, CH_ITEMS).io);
  yes("depth 6 allowed", r.ok);
  w = world(UNIT, ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"], maxPaths: 1 });
  eq("too many paths", r.code, "SC_TOO_MANY_PATHS");
  w = world(UNIT, ITEMS);
  r = await run(w, ITEMS, { itemId: "1", maxRows: 1 });
  eq("too many rows", r.code, "SC_TOO_MANY_ROWS");
  w = world(UNIT, ITEMS, { failBoms: true });
  r = await run(w, ITEMS, { itemId: "1" });
  eq("BOM read failure", r.code, "SC_READ_FAILED");
  w = world(UNIT, ITEMS, { failItems: true });
  r = await run(w, ITEMS, { itemId: "1" });
  eq("item read failure", r.code, "SC_READ_FAILED");
  w = world(UNIT, ITEMS, { dropItem: "4" });
  r = await run(w, ITEMS, { itemId: "1" });
  eq("a missing item is a read failure", r.code, "SC_READ_FAILED");
  // root UOM conversion: IA in CTN (1 CTN = 12 EA), root base EA
  const ITEMS_R = ITEMS.map((i) => (i.id === "1" ? item("1", { table_uom_conversion: [{ alt_uom_id: CTN, alt_qty: 1, base_qty: 12, base_uom_id: EA }] }) : i));
  w = world(UNIT, ITEMS_R);
  r = await run(w, ITEMS_R, { itemId: "1", itemUomId: CTN });
  eq("root converts the IA UOM to the BOM base", qtys(r), [["2", EA, 12], ["4", EA, 48]]);
  w = world(UNIT, ITEMS);
  r = await run(w, ITEMS, { itemId: "1", itemUomId: CTN });
  eq("root without that conversion stops", r.code, "SC_NO_CONVERSION");

  // ---------------------------------------------------------------- tree (Flat dialog)
  w = world([bom("10", "1", 1, [line("2", 1), line("4", 1), line("6", 1)]), bom("20", "2", 1, [line("3", 2)]), bom("60", "6", 1, [])], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: [] });
  eq("tree flags", r.tree.map((t) => [t.itemId, t.depth, t.expandable]), [["2", 1, true], ["4", 1, false], ["6", 1, false], ["3", 2, false]]);
  yes("tree reasons", r.tree.filter((t) => t.itemId === "6")[0].reason.length > 0);
  // the tree follows a line's ref_bom_id as the resolve does: the referenced BOM decides, names its version and gives the next level
  w = world([bom("10", "1", 1, [line("2", 1, { bom_type: "reference", ref_bom_id: "21" })]),
    bom("20", "2", 1, [line("3", 2)], { parent_mat_is_default: 1 }), bom("21", "2", 1, [line("5", 7)], { parent_mat_bom_version: "V2" })], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: [] });
  eq("tree follows ref_bom_id: 2, then the referenced BOM's 5 (not the default's 3)", r.tree.map((t) => [t.itemId, t.depth, t.expandable]), [["2", 1, true], ["5", 2, false]]);
  eq("tree names the referenced BOM", [r.tree[0].bomId, r.tree[0].version], ["21", "V2"]);
  w = world([bom("10", "1", 1, [line("2", 1, { bom_type: "reference", ref_bom_id: "99" })]), bom("20", "2", 1, [line("3", 2)], { parent_mat_is_default: 1 })], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: [] });
  eq("tree: a reference to a BOM that is not active: not expandable, said why", [r.tree[0].expandable, /no longer active/.test(r.tree[0].reason)], [false, true]);
  // a reference below the first level is followed too
  w = world([bom("10", "1", 1, [line("2", 1)]), bom("20", "2", 1, [line("3", 1, { bom_type: "reference", ref_bom_id: "31" })], { parent_mat_is_default: 1 }),
    bom("30", "3", 1, [line("6", 1)], { parent_mat_is_default: 1 }), bom("31", "3", 1, [line("5", 1)], { parent_mat_bom_version: "V7" })], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: [] });
  eq("tree follows a level-2 reference: 3 through BOM 31 (V7) to 5", r.tree.map((t) => [t.itemId, t.depth, t.version]), [["2", 1, "V1"], ["3", 2, "V7"], ["5", 3, ""]]);
  // BA handoff FIX-04: a tick applies to every occurrence, so the tree says how many BOM lines use the item, under which parents,
  // and every BOM version those lines resolve to
  w = world([bom("10", "1", 1, [line("2", 1), line("3", 1)]), bom("20", "2", 1, [line("3", 2, { bom_type: "reference", ref_bom_id: "31" })], { parent_mat_is_default: 1 }),
    bom("30", "3", 1, [line("6", 1)], { parent_mat_is_default: 1 }), bom("31", "3", 1, [line("5", 1)], { parent_mat_bom_version: "V7" })], ITEMS);
  r = await run(w, ITEMS, { itemId: "1", mode: "FLAT", expand: [] });
  const t3 = r.tree.filter((t) => t.itemId === "3")[0] || {};
  eq("tree: an item on 2 BOM lines: 2 uses, both parents, both versions", [t3.uses, t3.parents, t3.versions], [2, ["N1", "N2"], ["V1", "V7"]]);
  const t2 = r.tree.filter((t) => t.itemId === "2")[0] || {};
  eq("tree: an item on 1 line: 1 use, its parent, its version", [t2.uses, t2.parents, t2.versions], [1, ["N1"], ["V1"]]);

  // ---------------------------------------------------------------- scRecompute = scResolve
  const seeds = [0.5, 1, 3, 7.25, 12, 100, 0.333];
  let same = true;
  for (const q of seeds) {
    const a = await run(world(BASE, ITEMS), ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"], outputQty: q });
    const b = B.scRecompute(a.snapshot, q).map((x) => [x.itemId, x.uomId, x.qty]);
    if (JSON.stringify(b) !== JSON.stringify(qtys(a))) same = false;
    const c = await run(world(BASE, ITEMS), ITEMS, { itemId: "1", outputQty: q });
    if (JSON.stringify(B.scRecompute(c.snapshot, q).map((x) => [x.itemId, x.uomId, x.qty])) !== JSON.stringify(qtys(c))) same = false;
  }
  yes("recompute equals resolve (Standard and Flat)", same);
  const snap = (await run(world(BASE, ITEMS), ITEMS, { itemId: "1", mode: "FLAT", expand: ["2"], outputQty: 5 })).snapshot;
  BASE[1].subform_sub_material[0].sub_material_qty = "60";
  eq("recompute ignores a later BOM edit", B.scRecompute(snap, 5).map((x) => x.qty), [30, 20]);
  BASE[1].subform_sub_material[0].sub_material_qty = "6";
  eq("recompute at a new output", B.scRecompute(snap, 6).map((x) => x.qty), [36, 24]);

  // ---------------------------------------------------------------- scCheck
  const head = { bom_consumption_mode: "FLAT", item_id: "1", item_uom: EA, source_bom_id: "10", item_qty: 5 };
  const lines = [{ item_selection: "3", quantity_uom: EA, requested_qty: 30, sc_ref_key: "3|" + EA, total_quantity: 31 },
    { item_selection: "4", quantity_uom: EA, requested_qty: 20, sc_ref_key: "4|" + EA, total_quantity: 20 }];
  yes("check ok", B.scCheck(snap, head, lines, { completing: true }).ok);
  eq("check invalid", B.scCheck({ v: 2 }, head, lines, {}).code, "SC_SNAPSHOT_INVALID");
  eq("check text that is not JSON", B.scCheck("{oops", head, lines, {}).code, "SC_SNAPSHOT_INVALID");
  yes("check accepts JSON text", B.scCheck(JSON.stringify(snap), head, lines, { completing: true }).ok);
  eq("check mode mismatch", B.scCheck(snap, Object.assign({}, head, { bom_consumption_mode: "STANDARD" }), lines, {}).code, "SC_SNAPSHOT_MISMATCH");
  eq("check item mismatch", B.scCheck(snap, Object.assign({}, head, { item_id: "9" }), lines, {}).code, "SC_SNAPSHOT_MISMATCH");
  eq("check root BOM mismatch", B.scCheck(snap, Object.assign({}, head, { source_bom_id: "11" }), lines, {}).code, "SC_SNAPSHOT_MISMATCH");
  eq("check drift on Completed", B.scCheck(snap, Object.assign({}, head, { item_qty: 6 }), lines, { completing: true }).code, "SC_REF_QTY_DRIFT");
  yes("drift not checked on Draft", B.scCheck(snap, Object.assign({}, head, { item_qty: 6 }), lines, {}).ok);
  // the refusals name the button that fixes them (Prepare BOM), never a "refresh" the form does not have
  yes("check messages: press Prepare BOM", [B.scCheck({ v: 2 }, head, lines, {}), B.scCheck(snap, Object.assign({}, head, { item_id: "9" }), lines, {}),
    B.scCheck(snap, Object.assign({}, head, { item_qty: 6 }), lines, { completing: true })].every((x) => /press Prepare BOM/.test(x.message) && !/refresh/i.test(x.message)));
  const manual = lines.concat([{ item_selection: "9", quantity_uom: EA, requested_qty: 0, sc_ref_key: "", total_quantity: 2 }]);
  yes("manual line allowed", B.scCheck(snap, head, manual, { completing: true }).ok);
  const consumed = lines.concat([{ item_selection: "2", quantity_uom: EA, requested_qty: 0, sc_ref_key: "", total_quantity: 1 }]);
  eq("expanded item consumed", B.scCheck(snap, head, consumed, { completing: true }).code, "SC_EXPANDED_CONSUMED");

  console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.log("CRASH " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
