// node scratchpad/idav2/classic/test_v7.js - IDA_SAVE v7 bodies vs v6 (lifted) on the recorded dev runs (classic/fixture_paths.json),
// the per-base-unit receipt price on synthesized alternate-UOM lines (checked through ADD_INVENTORY v65's own bodies), and the guard
// bodies. Regenerate the lifts first: python3 scratchpad/idav2/lib/lift/lift.py scratchpad/idav2/classic/lift_v6.json (lift_v7, lift_add)
const fs = require("fs");
const path = require("path");
const IDAV2 = path.join(__dirname, "..");
const C = require(path.join(IDAV2, "code", "shared", "ida_common.js"));
const runtime = fs.readFileSync(path.join(IDAV2, "lib", "lift", "runtime.js"), "utf8");
const lifted = (file) => new Function(runtime + "\n" + fs.readFileSync(path.resolve(__dirname, file), "utf8") + "\nreturn { __run, __withContext, __set, __N };")();
const V6 = lifted("lifted_v6.js");
// IDA_LIFTED_V7 points the tests at another lift (classic/mutants_v7.py)
const V7 = lifted(process.env.IDA_LIFTED_V7 || "lifted_v7.js");
const ADD = lifted("lifted_add.js");

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + String(JSON.stringify(got)).slice(0, 700) + "\n  want " + String(JSON.stringify(want)).slice(0, 700));
  }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const out = (raw) => (C.idaParseJ(raw) || {}).data;
const run = (L, id, ctx) => L.__withContext(clone(ctx), () => L.__run(id));
const chain = (L, ctx, ids) => L.__withContext(clone(ctx), () => {
  const res = {};
  for (const id of ids) res[id] = L.__run(id);
  return res;
});
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const maskKey = (o) => Object.assign(clone(o), { cacheKey: "<run key>" });
const maskStamp = (o) => JSON.parse(JSON.stringify(o).replace(/"last_transaction_date":"[^"]*"/g, '"last_transaction_date":"<now>"'));

const PATHS = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture_paths.json"), "utf8"));
eq("two recorded dev runs listed, one of them ran v6", [PATHS.dev_runs.length, PATHS.ran_v6.length], [2, 1]);
const FX = {};
for (const r of PATHS.dev_runs) {
  const file = path.join(__dirname, "fixtures", r + ".json");
  if (!fs.existsSync(file)) {
    eq("dev fixture present: " + file, false, true);
    continue;
  }
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const req = C.idaParseJ(fx.request);
  const params = req.request_json || req;
  const N = {};
  for (const k of Object.keys(fx.nodes)) N[k] = out(fx.nodes[k]);
  FX[r] = { params: params, N: N };
  const ranV6 = PATHS.ran_v6.indexOf(r) >= 0;
  const tag = "dev " + r + (ranV6 ? " (v6)" : " (v4)");
  const base = { "workflowparams:allData": params.allData, "workflowparams:saveAs": params.saveAs, "workflowparams:pageStatus": params.pageStatus,
    "system:tenantId": "000000", "system:uid": "1123598821738675201" };
  // 1. fill-back -> required -> item ids from the REQUEST: v7 == v6 (== recorded on the v6 run)
  const a = chain(V6, base, ["code_fillback", "code_required", "code_item_ids"]);
  const b = chain(V7, base, ["code_fillback", "code_required", "code_item_ids"]);
  eq(tag + " fill-back / required / item ids: v7 == v6", b, a);
  if (ranV6) {
    eq(tag + " code_fillback == recorded", b.code_fillback, N.code_fillback);
    eq(tag + " code_required == recorded", b.code_required, N.code_required);
    eq(tag + " code_item_ids == recorded", b.code_item_ids, N.code_item_ids);
  }
  // 2. code_validate on the RECORDED inputs: v7 == v6 (== recorded)
  const vctx = Object.assign({}, base, { "node:code_fillback": { data: N.code_fillback }, "node:search_items": { data: N.search_items },
    "node:search_batches": { data: N.search_batches || { total: 0, count: 0, data: [] } } });
  const val7 = run(V7, "code_validate", vctx);
  eq(tag + " code_validate v7 == v6", val7, run(V6, "code_validate", vctx));
  eq(tag + " code_validate == recorded (Passed)", val7, N.code_validate);
  // 3. every other lifted body on the recorded inputs: v7 == v6; the receipt (code_cost_alloc) identical for these base-UOM lines
  const rctx = Object.assign({}, vctx, { "node:code_persisted": { data: N.code_persisted }, "node:search_movements": { data: N.search_movements },
    "node:code_apply_batches": { data: N.code_apply_batches }, "node:code_batch_plan": { data: N.code_batch_plan },
    "node:get_batches_final": { data: N.get_batches_final === undefined ? null : N.get_batches_final }, "node:add_ida": { data: N.add_ida },
    "node:get_ida": { data: null }, "node:add_draft": { data: null } });
  const cost7 = run(V7, "code_cost_alloc", rctx);
  eq(tag + " code_cost_alloc v7 == v6 (every line in its base UOM)", cost7, run(V6, "code_cost_alloc", rctx));
  if (ranV6) eq(tag + " code_cost_alloc == recorded", cost7, N.code_cost_alloc);
  for (const id of ["code_precheck_prep", "code_apply_batches", "code_persisted", "code_issue_prep", "code_hu_unloads", "code_doc_id"]) {
    eq(tag + " " + id + " v7 == v6", run(V7, id, rctx), run(V6, id, rctx));
  }
  eq(tag + " code_batch_plan v7 == v6 (run key masked)", maskKey(run(V7, "code_batch_plan", rctx)), maskKey(run(V6, "code_batch_plan", rctx)));
  eq(tag + " code_item_txn v7 == v6 (stamp masked)", maskStamp(run(V7, "code_item_txn", rctx)), maskStamp(run(V6, "code_item_txn", rctx)));
  if (ranV6) {
    for (const id of ["code_precheck_prep", "code_apply_batches", "code_persisted", "code_issue_prep", "code_hu_unloads", "code_doc_id"]) {
      eq(tag + " " + id + " == recorded", run(V7, id, rctx), N[id]);
    }
  }
  const issue = run(V7, "code_issue_prep", rctx);
  for (const p of issue.balancesToProcess || []) {
    const pctx = Object.assign({}, rctx, { "node:loop_issue_picks": p, "node:loop_precheck_picks": p });
    eq(tag + " code_issue_pick v7 == v6", run(V7, "code_issue_pick", pctx), run(V6, "code_issue_pick", pctx));
    eq(tag + " code_precheck_pick v7 == v6", run(V7, "code_precheck_pick", pctx), run(V6, "code_precheck_pick", pctx));
  }
  for (const r0 of cost7.receipts || []) {
    const lctx = Object.assign({}, rctx, { "node:loop_receipts": r0 });
    eq(tag + " code_receipt_pick v7 == v6", run(V7, "code_receipt_pick", lctx), run(V6, "code_receipt_pick", lctx));
  }
  // search_items (code_item_ids decides the ids) carries what v7's price reads: every line's item + the source item, each with its
  // table_uom_conversion rows (alt_uom_id exact digit text after idaParseJ, base_qty a number) and based_uom
  const byId = {};
  for (const it of N.search_items.data) byId[String(it.id)] = it;
  const want = [N.code_fillback.allData.item_id].concat(N.code_fillback.allData.stock_movement.map((l) => l.item_selection));
  eq(tag + " search_items rows carry table_uom_conversion (alt_uom_id digit text, numeric base_qty) and based_uom for every item",
    want.map((id) => {
      const it = byId[String(id)];
      return Boolean(it) && /^[0-9]{19}$/.test(String(it.based_uom)) && Array.isArray(it.table_uom_conversion) && it.table_uom_conversion.length > 0
        && it.table_uom_conversion.every((c) => /^[0-9]{19}$/.test(c.alt_uom_id) && typeof c.base_qty === "number");
    }), want.map(() => true));
  eq(tag + " every recorded line is in its item's base UOM (the v6 == v7 premise)",
    N.code_fillback.allData.stock_movement.map((l) => String(l.quantity_uom) === String(byId[String(l.item_selection)].based_uom)),
    N.code_fillback.allData.stock_movement.map(() => true));
  // the runtime shape (not the trace's): code_cost_alloc's own recorded output embeds itemData with the ids as exact strings
  if (ranV6) {
    const raw = fixturesRaw(r, "code_cost_alloc");
    eq(tag + " at run time code_cost_alloc saw alt_uom_id / based_uom as quoted 19-digit text",
      [/"alt_uom_id":"[0-9]{19}"/.test(raw), /"based_uom":"[0-9]{19}"/.test(raw), /"alt_uom_id":[0-9]/.test(raw)], [true, true, false]);
  }
}

function fixturesRaw(r, id) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", r + ".json"), "utf8")).nodes[id];
}

// what ADD_INVENTORY v65 books for one receipt (its own bodies: ItemData -> UOM Conversion -> cost price -> unitPrice & totalPrice)
const addBooks = (receipt) => ADD.__withContext({ "workflowparams:itemData": clone(receipt.itemData), "workflowparams:isMovingInv": 0,
  "workflowparams:quantity": receipt.quantity, "workflowparams:material_uom": receipt.material_uom, "workflowparams:unit_price": receipt.unit_price,
  "workflowparams:transaction_type": "IDA", "workflowparams:po_quantity": null, "workflowparams:po_amount": null, "workflowparams:exchange_rate": null }, () => {
  ADD.__run("code_node_3XzQSsce");
  const u = ADD.__run("code_node_mvszWJ8p");
  if (u.costingMethod === "First In First Out" || u.costingMethod === "Weighted Average") ADD.__run("code_node_3SC3WFhc");
  if (u.costingMethod === "Fixed Cost") ADD.__run("code_node_BDhmDHrJ");
  return Object.assign({ baseQty: u.baseQty }, ADD.__run("code_node_BzebhJnQ"));
});

// 4. the price fix on synthesized alternate-UOM lines (the v6 run's inputs; ALT is a UOM the item converts at 12 base units)
{
  const r = PATHS.ran_v6[0];
  const { params, N } = FX[r];
  // a synthetic UOM none of the run's items has (the run's UOMs are ...389 and ...392)
  const ALT = "2018906563477008777";
  const base = { "workflowparams:allData": params.allData, "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": "Add", "system:tenantId": "000000" };
  const withAlt = (k, factor, opts) => {
    const o = Object.assign({ uom: ALT, row: true, last: false }, opts || {});
    const fill = clone(N.code_fillback);
    const apply = clone(N.code_apply_batches);
    const items = clone(N.search_items);
    const lines = [fill.allData.stock_movement, apply.stock_movement];
    for (const ls of lines) ls[k].quantity_uom = o.uom;
    const it = items.data.find((x) => String(x.id) === String(fill.allData.stock_movement[k].item_selection));
    if (o.row) it.table_uom_conversion.push({ alt_qty: 1, alt_uom_id: ALT, base_qty: factor, base_uom_id: it.based_uom });
    return Object.assign({}, base, { "node:code_fillback": { data: fill }, "node:search_items": { data: items }, "node:code_persisted": { data: N.code_persisted },
      "node:search_movements": { data: N.search_movements }, "node:code_apply_batches": { data: apply } });
  };
  const lineValues = (ctx) => {
    const ls = ctx["node:code_apply_batches"].data.stock_movement;
    const issued = ctx["node:search_movements"].data.data.reduce((s, m) => s + (parseFloat(m.total_price) || 0), 0);
    const total = ls.reduce((s, l) => s + q8(l.total_quantity), 0);
    let rem = issued;
    return ls.map((l, i) => {
      const v = i === ls.length - 1 ? rem : (total > 0 ? issued * q8(l.total_quantity) / total : 0);
      rem -= v;
      return v;
    });
  };
  const nLines = N.code_apply_batches.stock_movement.length;
  for (const sc of [{ k: 0, factor: 12, label: "line 1, 12 base units per UOM (numeric base_qty)" },
    { k: 0, factor: "12.000000", label: "line 1, base_qty as decimal text" },
    { k: 2, factor: 0.25, label: "line 3, 0.25 base units per UOM" },
    { k: nLines - 1, factor: 6, label: "the LAST line (takes the remainder), 6 base units per UOM" }]) {
    const ctx = withAlt(sc.k, sc.factor);
    const c6 = run(V6, "code_cost_alloc", ctx);
    const c7 = run(V7, "code_cost_alloc", ctx);
    const lv = lineValues(ctx);
    const qty = q8(ctx["node:code_apply_batches"].data.stock_movement[sc.k].total_quantity);
    const baseQty = q8(qty * Number(sc.factor));
    const r7 = c7.receipts[sc.k];
    eq("alt UOM " + sc.label + ": v7 unit price = line value / base qty", r7.unit_price, q8(lv[sc.k] / baseQty));
    eq("alt UOM " + sc.label + ": v6 priced it per line unit (the bug)", c6.receipts[sc.k].unit_price, q8(lv[sc.k] / qty));
    const books = addBooks(r7);
    eq("alt UOM " + sc.label + ": ADD_INVENTORY v65's own conversion gives the same base qty", books.baseQty, baseQty);
    const residue = Math.abs(q8(r7.unit_price * baseQty) - lv[sc.k]);
    eq("alt UOM " + sc.label + ": q8(unit price x base qty) = line value up to q8 (residue " + residue.toExponential(2) + ")",
      residue <= baseQty * 5e-9 + 1e-8, true);
    eq("alt UOM " + sc.label + ": ADD books total_price = line value up to q8", Math.abs(books.totalPrice - lv[sc.k]) <= baseQty * 5e-9 + 1e-8, true);
    eq("alt UOM " + sc.label + ": v6's price made ADD book factor x the line value", Math.abs(addBooks(c6.receipts[sc.k]).totalPrice - q8(lv[sc.k] * Number(sc.factor)))
      <= baseQty * 5e-9 + 1e-8, true);
    eq("alt UOM " + sc.label + ": every other receipt == v6", c7.receipts.filter((x, i) => i !== sc.k), c6.receipts.filter((x, i) => i !== sc.k));
    eq("alt UOM " + sc.label + ": quantity / issued value / receipt fields == v6 (only unit_price moves)",
      [Object.assign({}, r7, { unit_price: 0 }), c7.issuedValue], [Object.assign({}, c6.receipts[sc.k], { unit_price: 0 }), c6.issuedValue]);
  }
  const noRow = withAlt(0, 12, { row: false });
  eq("alt UOM without a conversion row: 1:1 (ADD's fallback), price == v6", run(V7, "code_cost_alloc", noRow), run(V6, "code_cost_alloc", noRow));
  eq("alt UOM without a conversion row: ADD's base qty = qty", addBooks(run(V7, "code_cost_alloc", noRow).receipts[0]).baseQty,
    q8(noRow["node:code_apply_batches"].data.stock_movement[0].total_quantity));
  const blank = withAlt(0, 12, { uom: "" });
  eq("blank quantity_uom: the item's base UOM row (1:1), price == v6", run(V7, "code_cost_alloc", blank), run(V6, "code_cost_alloc", blank));
  const zero = withAlt(0, 0);
  eq("a conversion row with base_qty 0: unit price 0 (no division by zero)", run(V7, "code_cost_alloc", zero).receipts[0].unit_price, 0);
  const numUom = withAlt(0, 12);
  numUom["node:search_items"].data.data.forEach((it) => it.table_uom_conversion.forEach((c) => {
    if (c.alt_uom_id === ALT) c.alt_uom_id = "  " + ALT;
  }));
  eq("alt_uom_id compared as exact text (a padded id does not match, as ADD's ===)", addBooks(run(V7, "code_cost_alloc", numUom).receipts[0]).baseQty,
    run(V7, "code_cost_alloc", numUom).receipts[0].quantity);
  // the base-UOM lines of both runs, through ADD's own bodies: total_price = the receipt's line value (unchanged from v6)
  for (const rr of PATHS.dev_runs) {
    const { N: M } = FX[rr];
    const ctx = Object.assign({}, base, { "node:code_fillback": { data: M.code_fillback }, "node:search_items": { data: M.search_items },
      "node:code_persisted": { data: M.code_persisted }, "node:search_movements": { data: M.search_movements },
      "node:code_apply_batches": { data: M.code_apply_batches } });
    const c7 = run(V7, "code_cost_alloc", ctx);
    const lv = lineValues(ctx);
    eq("dev " + rr + ": ADD books every base-UOM receipt at its line value (q8)", c7.receipts.map((x, i) => Math.abs(addBooks(x).totalPrice - lv[i]) <= 1e-7),
      c7.receipts.map(() => true));
  }
}

// 5. the guard bodies (lifted from the built v7)
{
  const BIN = "2018912822846582786";
  const picksText = (k) => JSON.stringify(Array.from({ length: k }, (_, i) => ({ sm_quantity: 1, location_id: BIN, balance_id: String(9000 + i) })));
  const linesOf = (k) => Array.from({ length: k }, (_, i) => ({ item_selection: "2107721546371891202", total_quantity: 1, line_index: i + 1 }));
  const doc = (page, id, nPicks, nLines, extra) => Object.assign({ id: id, page_status: page, temp_qty_data: picksText(nPicks), stock_movement: linesOf(nLines) },
    extra || {});
  const gin = (allData, saveAs, page, tenant) => run(V7, "code_node_IDAguardIn", { "workflowparams:allData": allData, "workflowparams:saveAs": saveAs,
    "workflowparams:pageStatus": page, "system:tenantId": tenant === undefined ? "000000" : tenant });
  const gst = (inOut, stored) => run(V7, "code_node_IDAguardStored", { "node:code_node_IDAguardIn": { data: inOut },
    "node:sql_node_IDAguard": { data: stored === null ? [] : [{ ida_id: inOut.idaId, item_disassembly_status: stored }] } });
  const ID = "2112073133161844738";
  const TOO_BIG = (n0) => "This Item Disassembly has " + n0 + " source picks and recovery lines - too big for the classic save, which handles at most 250 at once. "
    + "Complete it from the web form with background completion switched on, or split it into smaller disassemblies.";
  const BUSY = "This Item Disassembly is being processed in the background - please wait for it to finish.";
  const e = gin(doc("Edit", ID, 1, 3), "Completed", "Edit");
  eq("Edit with a digit id reads the stored status", [e.check, e.idaId, e.tenantId, e.moves, e.big, e.bigNoRead], ["YES", ID, "000000", "4", "NO", "NO"]);
  eq("Add never reads", gin(doc("Add", undefined, 1, 3), "Completed", "Add").check, "NO");
  eq("Clone keeps the source id but never reads", gin(doc("Clone", ID, 1, 3), "Draft", "Clone").check, "NO");
  eq("Copy (= Clone) never reads", gin(doc("Copy", ID, 1, 3), "Completed", "Copy").check, "NO");
  eq("Edit with an unsafe NUMBER id: no read", gin(doc("Edit", 2112073133161844738, 1, 3), "Completed", "Edit").check, "NO");
  eq("Edit without a session tenant: no read", gin(doc("Edit", ID, 1, 3), "Completed", "Edit", "").check, "NO");
  eq("Edit with a non-digit id: no read", gin(doc("Edit", "12a", 1, 3), "Completed", "Edit").check, "NO");
  eq("250 moves (1 pick + 249 lines): not big", gin(doc("Add", undefined, 1, 249), "Completed", "Add").big, "NO");
  const big = gin(doc("Add", undefined, 1, 250), "Completed", "Add");
  eq("251 moves (1 pick + 250 lines), Add: refused without a read", [big.moves, big.big, big.bigNoRead, big.bigMessage], ["251", "YES", "YES", TOO_BIG(251)]);
  eq("251 moves (3 picks + 248 lines): big", gin(doc("Add", undefined, 3, 248), "Completed", "Add").big, "YES");
  eq("251 moves saved as Draft: exempt", gin(doc("Add", undefined, 1, 250), "Draft", "Add").big, "NO");
  eq("251 moves, Edit: refused after the read (bigNoRead NO)", [gin(doc("Edit", ID, 1, 250), "Completed", "Edit").big, gin(doc("Edit", ID, 1, 250), "Completed", "Edit").bigNoRead],
    ["YES", "NO"]);
  eq("251 moves, Clone: refused without a read", [gin(doc("Clone", ID, 1, 250), "Completed", "Clone").big, gin(doc("Clone", ID, 1, 250), "Completed", "Clone").bigNoRead],
    ["YES", "YES"]);
  eq("zero-quantity picks are not moves", gin(doc("Add", undefined, 0, 2, { temp_qty_data: '[{"sm_quantity":0},{"sm_quantity":"2"}]' }), "Completed", "Add").moves, "3");
  eq("lines without an item are not moves", gin(doc("Add", undefined, 1, 0, { stock_movement: [{ item_selection: "" }, { item_selection: "1" }, {}] }), "Completed", "Add")
    .moves, "2");
  eq("temp_qty_data as an array", gin(doc("Add", undefined, 0, 1, { temp_qty_data: [{ sm_quantity: 1 }, { sm_quantity: 2 }] }), "Completed", "Add").moves, "3");
  eq("unparseable temp_qty_data: no picks", gin(doc("Add", undefined, 0, 2, { temp_qty_data: "[{bad" }), "Completed", "Add").moves, "2");
  eq("allData as JSON text", gin(JSON.stringify(doc("Edit", ID, 1, 2)), "Completed", "Edit").check, "YES");
  eq("allData missing: passes through", [gin(null, "Completed", "Add").check, gin(null, "Completed", "Add").big], ["NO", "NO"]);
  eq("stored Processing, Completed: 400", gst(e, "Processing"), { stored: "Processing", refuse400: "YES", refuse409: "NO", message: BUSY });
  eq("stored Processing, Draft: 400", gst(gin(doc("Edit", ID, 1, 3), "Draft", "Edit"), "Processing").refuse400, "YES");
  eq("stored Completed, Draft: 409", gst(gin(doc("Edit", ID, 1, 3), "Draft", "Edit"), "Completed"),
    { stored: "Completed", refuse400: "NO", refuse409: "YES", message: "This Item Disassembly is already Completed and cannot be saved again." });
  eq("stored Fully Posted, Draft: 409", gst(gin(doc("Edit", ID, 1, 3), "Draft", "Edit"), "Fully Posted").message,
    "This Item Disassembly is already Fully Posted and cannot be saved again.");
  eq("the 409 text = v6 code_idem_guard's", gst(gin(doc("Edit", ID, 1, 3), "Draft", "Edit"), "Completed").message,
    run(V6, "code_idem_guard", { "node:get_persisted_ida": { data: { count: 1, data: { item_disassembly_status: "Completed" } } } }).blockedMessage);
  eq("stored Completed, Completed: left to the classic (401 / 409)", gst(e, "Completed"), { stored: "Completed", refuse400: "NO", refuse409: "NO", message: "" });
  eq("stored Draft: passes", gst(e, "Draft"), { stored: "Draft", refuse400: "NO", refuse409: "NO", message: "" });
  eq("stored Issued, Draft: passes", gst(gin(doc("Edit", ID, 1, 3), "Draft", "Edit"), "Issued").refuse409, "NO");
  const eb = gin(doc("Edit", ID, 1, 250), "Completed", "Edit");
  eq("stored Draft, 251 moves: 400 too big", [gst(eb, "Draft").refuse400, gst(eb, "Draft").message], ["YES", eb.bigMessage]);
  eq("stored Processing beats too big", gst(eb, "Processing").message, BUSY);
  eq("stored row missing: only the cap applies", [gst(e, null).refuse400, gst(e, null).refuse409, gst(eb, null).refuse400], ["NO", "NO", "YES"]);
}

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
