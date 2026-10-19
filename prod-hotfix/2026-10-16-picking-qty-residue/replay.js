// BUG-20261016-023 replay: runs the REAL code of the Picking qty validator, PP_Convert_Picking's
// "Map Picking Data" and PICKING_PLAN's "Table TO" against the values from the prod incident.
//   node replay.js <picking_form.json> <PPconvertToPicking.json> <PPheadWorkflow.json>
const fs = require("fs");
const [formFile, convFile, ppFile] = process.argv.slice(2);
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
  if (!ok) failed++;
};
const findNode = (wf, id) => {
  let hit = null;
  const walk = (n) => {
    if (hit || !n || typeof n !== "object") return;
    if (n.id === id && n.data) hit = n;
    Object.values(n).forEach(walk);
  };
  walk(wf);
  return hit;
};

// ---- 1. Picking form validator (table_picking_items.picked_qty) ----
const form = JSON.parse(fs.readFileSync(formFile, "utf8"));
const col = form.list[2].tabs[0].list[0].tableColumns[23];
check("validator copies identical", col.options.validator === col.rules[0].func);
const validate = (row, value, cache) => {
  global.window = { pickingUOMCache: cache || {} };
  let msg = "unset";
  const fn = new Function("rule", "value", "callback", col.options.validator);
  fn.call({ getValues: () => ({ table_picking_items: [row] }) },
    { field: "table_picking_items.0.picked_qty" }, value, (m) => { msg = m; });
  return msg; // undefined = accepted
};
const MT = "2030677223047372828", BAG = "2030677223047372803", ITEM = "2030683678890729510";
const tafCache = { [ITEM]: { based_uom: BAG, table_uom_conversion: [
  { alt_uom_id: BAG, base_qty: 1 }, { alt_uom_id: MT, base_qty: 20 }] } };
const row = (pending, pickUom) => ({ item_code: ITEM, item_uom: MT, picking_uom: pickUom || MT,
  pending_process_qty: pending });
check("TAF: pending 32.94999999999999 M/T, typed 32.95 M/T is accepted",
  validate(row(32.94999999999999), "32.95", tafCache) === undefined);
check("stored-truncated pending 32.94999999, typed 32.95 is accepted",
  validate(row("32.94999999"), "32.95", tafCache) === undefined);
check("exact 32.95 / 32.95 is accepted", validate(row("32.95000000"), "32.95", tafCache) === undefined);
check("real over-pick 32.951 vs 32.95 is rejected",
  validate(row("32.95000000"), "32.951", tafCache) === "Quantity is not enough to pick");
check("real over-pick 33 vs 32.95 is rejected",
  validate(row(32.94999999999999), "33", tafCache) === "Quantity is not enough to pick");
check("alt UOM: 659 BAG vs 32.95 M/T pending is accepted",
  validate(row(32.94999999999999, BAG), "659", tafCache) === undefined);
check("alt UOM: 660 BAG vs 32.95 M/T pending is rejected",
  validate(row(32.94999999999999, BAG), "660", tafCache) === "Quantity is not enough to pick");
check("no cache, same UOM: 1 vs 0.99999999 is accepted",
  validate({ item_code: "x", item_uom: "u", picking_uom: "u", pending_process_qty: "0.99999999" }, "1") === undefined);

// ---- 2. PP_Convert_Picking "Map Picking Data" ----
const conv = JSON.parse(fs.readFileSync(convFile, "utf8"));
const runConv = (lines) => {
  const node = findNode(conv, "code_node_8MJPH5aT");
  const ppData = { id: "2110992958496051202", to_no: "CA-4098", so_no: "SO-T02608-004",
    customer_name: "c", plant_id: "p", organization_id: "o", table_to: lines };
  const code = node.data.script.code
    .replace(/\{\{node:search_node_zLieZ0R4\.data\.data\}\}/g, JSON.stringify([ppData]))
    .replace(/\{\{workflowparams:plant_id\}\}/g, '"p"');
  return new Function(code)();
};
const ppLine = (temp, picked) => ({ id: "2110992958584131589", material_id: ITEM, material_name: "OPCOM55S",
  to_order_uom_id: MT, to_qty: 32.95, line_so_no: "SO-T02608-004", line_so_id: "s", so_line_item_id: "sl",
  temp_qty_data: JSON.stringify(temp), picked_temp_qty_data: picked ? JSON.stringify(picked) : "" });
const items = (out) => (out.data || out).table_picking_items || [];
let out = runConv([ppLine([{ material_id: ITEM, location_id: "L1", to_quantity: 32.94999999999999 }])]);
let r0 = items(out)[0] || {};
check("convert: TAF temp 32.94999999999999 -> qty_to_pick 32.95",
  r0.qty_to_pick === 32.95 && r0.pending_process_qty === 32.95, `${r0.qty_to_pick} / ${r0.pending_process_qty}`);
out = runConv([ppLine([{ material_id: ITEM, location_id: "L1", to_quantity: 0.8 }],
  [{ location_id: "L1", to_quantity: 0.7 }, { location_id: "L1", to_quantity: 0.1 }])]);
check("convert: fully picked line (0.8 - 0.7 - 0.1) yields no phantom row", items(out).length === 0,
  `rows=${items(out).length} qty=${(items(out)[0] || {}).qty_to_pick}`);
out = runConv([ppLine([{ material_id: ITEM, location_id: "L1", to_quantity: 0.1 },
  { material_id: ITEM, location_id: "L1", to_quantity: 0.2 }])]);
r0 = items(out)[0] || {};
check("convert: two allocations 0.1 + 0.2 on one bin -> 0.3", r0.qty_to_pick === 0.3, `${r0.qty_to_pick}`);

// ---- 3. PICKING_PLAN "Table TO" (code_node_8Z1krUr1) ----
const pp = JSON.parse(fs.readFileSync(ppFile, "utf8"));
const tt = findNode(pp, "code_node_8Z1krUr1").data.script.code;
const runTT = (allData) => new Function(tt
  .replace("{{node:code_node_Nj60Z2XF.data.allData}}", JSON.stringify(allData))
  .replace(/\{\{node:[^}]+\}\}/g, "null"))();
const temp = (q) => JSON.stringify([{ material_id: ITEM, location_id: "L1", to_quantity: q, balance_quantity: 1100 }]);
const tt1 = runTT({ table_to: [{ id: "a", to_qty: 32.94999999999999, temp_qty_data: temp(32.94999999999999),
  children: [{ id: "b", to_qty: 1, temp_qty_data: temp(0.7999999999999999) }] }, { id: "c", temp_qty_data: "" }] });
const t0 = tt1.allData.table_to[0];
check("PICKING_PLAN: temp_qty_data to_quantity 32.94999999999999 -> 32.95",
  JSON.parse(t0.temp_qty_data)[0].to_quantity === 32.95, t0.temp_qty_data);
check("PICKING_PLAN: bundle child temp_qty_data rounded too",
  JSON.parse(t0.children[0].temp_qty_data)[0].to_quantity === 0.8, t0.children[0].temp_qty_data);
check("PICKING_PLAN: other temp fields untouched", JSON.parse(t0.temp_qty_data)[0].balance_quantity === 1100);
check("PICKING_PLAN: empty temp_qty_data left as is", tt1.allData.table_to[1].temp_qty_data === "");
check("PICKING_PLAN: unparseable temp_qty_data left as is",
  runTT({ table_to: [{ id: "d", temp_qty_data: "not json" }] }).allData.table_to[0].temp_qty_data === "not json");

console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
