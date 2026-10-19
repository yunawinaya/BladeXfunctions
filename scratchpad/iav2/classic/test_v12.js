// node scratchpad/iav2/classic/test_v12.js - IA_SAVE v12 bodies vs v11 (lifted) on the recorded runs (classic/fixture_paths.json), the
// non-stock rule, the unchanged receipt price, and the guard bodies. Regenerate the lifts first:
//   python3 scratchpad/iav2/lib/lift/lift.py scratchpad/iav2/classic/lift_v11.json (and lift_v12.json)
const fs = require("fs");
const path = require("path");
const IAV2 = path.join(__dirname, "..");
const C = require(path.join(IAV2, "code", "shared", "ia_common.js"));
const runtime = fs.readFileSync(path.join(IAV2, "lib", "lift", "runtime.js"), "utf8");
const lifted = (file) => new Function(runtime + "\n" + fs.readFileSync(path.join(__dirname, file), "utf8") + "\nreturn { __run, __withContext, __set, __N };")();
const V11 = lifted("lifted_v11.js");
const V12 = lifted("lifted_v12.js");

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 600) + "\n  want " + JSON.stringify(want).slice(0, 600));
  }
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const out = (raw) => (C.iaParseJ(raw) || {}).data;
const run = (L, id, ctx) => L.__withContext(clone(ctx), () => L.__run(id));
// a chain of lifted nodes over one context (each output lands under node:<id>, as on the platform)
const chain = (L, ctx, ids) => L.__withContext(clone(ctx), () => {
  const res = {};
  for (const id of ids) res[id] = L.__run(id);
  return res;
});

// the dev runs live beside this test, the prod run outside the repo (classic/fixture_paths.json); an absent prod file is skipped, loudly
const PATHS = JSON.parse(fs.readFileSync(path.join(__dirname, "fixture_paths.json"), "utf8"));
const PROD_DIR = process.env.IAV2_PROD_FIXTURES || PATHS.prod_dir;
const skipped = [];
const fixtures = PATHS.dev_runs.map((r) => ({ file: path.join(__dirname, "fixtures", r + ".json"), prod: false }))
  .concat(PATHS.prod_runs.map((r) => ({ file: path.join(PROD_DIR, r + ".json"), prod: true })));
eq("three recorded runs listed (2 dev, 1 prod)", [PATHS.dev_runs.length, PATHS.prod_runs.length], [2, 1]);
for (const { file, prod } of fixtures) {
  if (!fs.existsSync(file)) {
    if (!prod) {
      eq("dev fixture present: " + file, false, true);
      continue;
    }
    skipped.push(file);
    console.log("SKIPPED prod fixture (absent): " + file + " - re-pull read-only: python3 scratchpad/iav2/classic/fetch_fixtures.py --prod");
    continue;
  }
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const req = C.iaParseJ(fx.request);
  const params = req.request_json || req;
  const N = {};
  for (const k of Object.keys(fx.nodes)) N[k] = out(fx.nodes[k]);
  const base = { "workflowparams:allData": params.allData, "workflowparams:saveAs": params.saveAs, "workflowparams:pageStatus": params.pageStatus,
    "system:tenantId": "000000" };
  const tag = fx.env + " " + fx.run;
  // 1. fill-back -> required -> item ids from the REQUEST: v12 == v11
  const a = chain(V11, base, ["code_fillback", "code_required", "code_item_ids"]);
  const b = chain(V12, base, ["code_fillback", "code_required", "code_item_ids"]);
  eq(tag + " fill-back / required / item ids: v12 == v11", b, a);
  eq(tag + " item ids == recorded", b.code_item_ids.itemIds, N.code_item_ids.itemIds);
  // 2. code_validate on the RECORDED inputs (code_fillback + search_items outputs): v12 == v11 == recorded
  const vctx = Object.assign({}, base, { "node:code_fillback": { data: N.code_fillback }, "node:search_items": { data: N.search_items } });
  const v11 = run(V11, "code_validate", vctx);
  const v12 = run(V12, "code_validate", vctx);
  eq(tag + " code_validate v12 == v11", v12, v11);
  eq(tag + " code_validate == recorded", v12, N.code_validate);
  // 3. the per-line / per-pick bodies, batch decision, receipt, HU, item dates: v12 == v11 on the recorded inputs
  const rctx = Object.assign({}, vctx, { "node:code_persisted": { data: N.code_persisted }, "node:search_movements": { data: N.search_movements },
    "node:code_batch_number": { data: N.code_batch_number } });
  for (const id of ["code_batch_decide", "code_receipt_prep", "code_hu_unloads"]) eq(tag + " " + id + " v12 == v11", run(V12, id, rctx), run(V11, id, rctx));
  eq(tag + " code_receipt_prep == recorded", run(V12, "code_receipt_prep", rctx), N.code_receipt_prep);
  const lines = N.code_fillback.allData.stock_movement;
  lines.forEach((line, i) => {
    const lctx = Object.assign({}, rctx, { "node:loop_precheck_lines": line, "node:loop_issue_lines": line });
    eq(tag + " line " + (i + 1) + " code_precheck_line v12 == v11", run(V12, "code_precheck_line", lctx), run(V11, "code_precheck_line", lctx));
    const il = run(V12, "code_issue_line", lctx);
    eq(tag + " line " + (i + 1) + " code_issue_line v12 == v11", il, run(V11, "code_issue_line", lctx));
    for (const p of il.balancesToProcess || []) {
      const pctx = Object.assign({}, lctx, { "node:loop_issue_picks": p, "node:loop_precheck_picks": p });
      eq(tag + " line " + (i + 1) + " code_issue_pick v12 == v11", run(V12, "code_issue_pick", pctx), run(V11, "code_issue_pick", pctx));
    }
  });
  // search_items (code_item_ids decides the ids) carries what v12 / the receipt read for every line's item and the parent
  const byId = {};
  for (const it of N.search_items.data) byId[String(it.id)] = it;
  const want = [N.code_fillback.allData.item_id].concat(N.code_fillback.allData.stock_movement.map((l) => l.item_selection));
  eq(tag + " search_items holds every line's item + the parent, each with a numeric stock_control and a UOM table",
    want.map((id) => Boolean(byId[String(id)]) && typeof byId[String(id)].stock_control === "number" && Array.isArray(byId[String(id)].table_uom_conversion)),
    want.map(() => true));
  eq(tag + " search_items ids == code_item_ids", N.search_items.data.map((it) => String(it.id)).sort(), N.code_item_ids.itemIds.slice().sort());
  if (N.get_persisted_ia) {
    const gctx = Object.assign({}, rctx, { "node:get_persisted_ia": { data: N.get_persisted_ia } });
    eq(tag + " code_idem_guard v12 == v11", run(V12, "code_idem_guard", gctx), run(V11, "code_idem_guard", gctx));
  }
}

// 4. the non-stock rule (user decision 2026-10-19 ~15:45) on the dev TES500 run
{
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "2110283309582323714.json"), "utf8"));
  const N = {};
  for (const k of Object.keys(fx.nodes)) N[k] = out(fx.nodes[k]);
  const DL = "1999999999999990001";
  const addLine = (fill, extra) => {
    const x = clone(fill);
    x.allData.stock_movement.push(Object.assign({ item_selection: DL, item_name: "Direct Labour", total_quantity: 2, requested_qty: 2, quantity_uom: "2018906563477008392",
      temp_qty_data: "", line_index: x.allData.stock_movement.length + 1 }, extra || {}));
    return x;
  };
  const items = (sc) => {
    const x = clone(N.search_items);
    x.data.push({ id: DL, material_code: "DL", stock_control: sc, item_batch_management: 0, material_costing_method: "Fixed Cost" });
    return x;
  };
  const ctx = (fill, it) => ({ "workflowparams:saveAs": "Completed", "node:code_fillback": { data: fill }, "node:search_items": { data: it } });
  const dl = addLine(N.code_fillback);
  eq("non-stock line, no picks: v11 refuses it", run(V11, "code_validate", ctx(dl, items(0))),
    { status: "Failed", message: "Line 2 (Direct Labour): no stock has been allocated." });
  eq("non-stock line, no picks: v12 passes", run(V12, "code_validate", ctx(dl, items(0))), { status: "Passed", message: "" });
  eq("non-stock line, stale picks ignored: v12 passes", run(V12, "code_validate", ctx(addLine(N.code_fillback, { temp_qty_data: '[{"sm_quantity":9}]' }), items(0))),
    { status: "Passed", message: "" });
  eq("non-stock line, quantity 0: v12 refuses", run(V12, "code_validate", ctx(addLine(N.code_fillback, { total_quantity: 0 }), items(0))),
    { status: "Failed", message: "Line 2 (Direct Labour): quantity must be greater than zero." });
  eq("stock line without picks: v12 still refuses", run(V12, "code_validate", ctx(dl, items(1))),
    { status: "Failed", message: "Line 2 (Direct Labour): no stock has been allocated." });
  eq("stock_control NULL: still a stock line", run(V12, "code_validate", ctx(dl, items(null))),
    { status: "Failed", message: "Line 2 (Direct Labour): no stock has been allocated." });
  eq("stock_control '0' text: still a stock line (search_items gives a number)", run(V12, "code_validate", ctx(dl, items("0"))),
    { status: "Failed", message: "Line 2 (Direct Labour): no stock has been allocated." });
  // fix wave R5: at least one stock line (with its picks); an IA of non-stock lines only is refused with v11's own text
  const NO_COMPONENTS = { status: "Failed", message: "There are no components to consume. Add at least one component line." };
  const onlyDl = (extra) => {
    const x = clone(N.code_fillback);
    x.allData.stock_movement = [Object.assign({ item_selection: DL, item_name: "Direct Labour", total_quantity: 2, requested_qty: 2, quantity_uom: "2018906563477008392",
      temp_qty_data: "", line_index: 1 }, extra || {}), { item_selection: DL, item_name: "Variable Overhead", total_quantity: 1, temp_qty_data: "", line_index: 2 }];
    return x;
  };
  eq("R5: non-stock lines only -> v12 refuses (v11's text)", run(V12, "code_validate", ctx(onlyDl(), items(0))), NO_COMPONENTS);
  eq("R5: non-stock lines only -> v11 refused it too", run(V11, "code_validate", ctx(onlyDl(), items(0))),
    { status: "Failed", message: "Line 1 (Direct Labour): no stock has been allocated." });
  eq("R5: non-stock lines only, one with qty 0 -> still the no-components text", run(V12, "code_validate", ctx(onlyDl({ total_quantity: 0 }), items(0))), NO_COMPONENTS);
  eq("R5: non-stock lines only, stale picks on them -> refused", run(V12, "code_validate", ctx(onlyDl({ temp_qty_data: '[{"sm_quantity":2}]' }), items(0))),
    NO_COMPONENTS);
  const mixedFirst = clone(dl);
  mixedFirst.allData.stock_movement.reverse();
  eq("R5: mixed (the non-stock line first) -> passes", run(V12, "code_validate", ctx(mixedFirst, items(0))), { status: "Passed", message: "" });
  eq("R5: an item search_items does not return counts as a stock line (needs picks, as v11)", run(V12, "code_validate",
    ctx(onlyDl(), { total: 1, count: 1, data: N.search_items.data })), { status: "Failed", message: "Line 1 (Direct Labour): no stock has been allocated." });
  eq("R5: no lines at all -> the same text as v11", [run(V12, "code_validate", ctx(Object.assign(clone(N.code_fillback), { allData: Object.assign(clone(N.code_fillback.allData),
    { stock_movement: [] }) }), items(0))), run(V11, "code_validate", ctx(Object.assign(clone(N.code_fillback), { allData: Object.assign(clone(N.code_fillback.allData),
    { stock_movement: [] }) }), items(0)))], [NO_COMPONENTS, NO_COMPONENTS]);
  // the receipt price is unchanged: same OUT movements, the non-stock line adds nothing
  const rctx = (fill) => Object.assign(ctx(fill, items(0)), { "node:code_persisted": { data: N.code_persisted }, "node:search_movements": { data: N.search_movements },
    "node:code_batch_number": { data: N.code_batch_number } });
  eq("receipt with the non-stock line == without it", run(V12, "code_receipt_prep", rctx(dl)), run(V12, "code_receipt_prep", rctx(N.code_fillback)));
  eq("receipt == the recorded receipt", run(V12, "code_receipt_prep", rctx(dl)), N.code_receipt_prep);
  const dlLine = dl.allData.stock_movement[1];
  const lctx = Object.assign(rctx(dl), { "node:loop_precheck_lines": dlLine, "node:loop_issue_lines": dlLine });
  eq("non-stock line: no pre-check call", run(V12, "code_precheck_line", lctx).balancesToProcess, []);
  eq("non-stock line: no SUBTRACT call", run(V12, "code_issue_line", lctx).balancesToProcess, []);
  eq("non-stock line: its item gets the date stamp as before", run(V12, "code_item_txn", rctx(dl)).updates.map((u) => u.id),
    run(V11, "code_item_txn", rctx(dl)).updates.map((u) => u.id));
}

// 5. the guard bodies (lifted from the built v12)
{
  const picks = (k) => JSON.stringify(Array.from({ length: k }, (_, i) => ({ sm_quantity: 1, location_id: "2018912822846582786", balance_id: String(i) })));
  const doc = (page, id, nPicks, extra) => Object.assign({ id: id, page_status: page, stock_movement: [{ item_selection: "2094626841323700252", temp_qty_data: picks(nPicks) }] },
    extra || {});
  const gin = (allData, saveAs, page, tenant) => run(V12, "code_node_IAguardIn", { "workflowparams:allData": allData, "workflowparams:saveAs": saveAs,
    "workflowparams:pageStatus": page, "system:tenantId": tenant === undefined ? "000000" : tenant });
  const gst = (inOut, stored) => run(V12, "code_node_IAguardStored", { "node:code_node_IAguardIn": { data: inOut },
    "node:sql_node_IAguard": { data: stored === null ? [] : [{ ia_id: inOut.iaId, item_assembly_status: stored }] } });
  const ID = "2112073133161844738";
  const e = gin(doc("Edit", ID, 3), "Completed", "Edit");
  eq("Edit with a digit id reads the stored status", [e.check, e.iaId, e.tenantId, e.picks, e.big, e.bigNoRead], ["YES", ID, "000000", "3", "NO", "NO"]);
  eq("Add never reads", gin(doc("Add", undefined, 3), "Completed", "Add").check, "NO");
  eq("Clone keeps the source id but never reads", gin(doc("Clone", ID, 3), "Draft", "Clone").check, "NO");
  eq("Edit with an unsafe NUMBER id: no read", gin(doc("Edit", 2112073133161844738, 3), "Completed", "Edit").check, "NO");
  eq("Edit without a session tenant: no read", gin(doc("Edit", ID, 3), "Completed", "Edit", "").check, "NO");
  eq("250 picks: not big", gin(doc("Add", undefined, 250), "Completed", "Add").big, "NO");
  const big = gin(doc("Add", undefined, 251), "Completed", "Add");
  eq("251 picks, Add: refused without a read", [big.big, big.bigNoRead, big.bigMessage],
    ["YES", "YES", "This Item Assembly has 251 stock picks; this save can process at most 250 at once. Split it into smaller assemblies, or complete it from the web form if background completion is switched on."]);
  eq("251 picks saved as Draft: exempt", gin(doc("Add", undefined, 251), "Draft", "Add").big, "NO");
  eq("251 picks, Edit: refused after the read (bigNoRead NO)", [gin(doc("Edit", ID, 251), "Completed", "Edit").big, gin(doc("Edit", ID, 251), "Completed", "Edit").bigNoRead],
    ["YES", "NO"]);
  eq("zero-quantity picks are not counted", gin(doc("Add", undefined, 0, { stock_movement: [{ temp_qty_data: '[{"sm_quantity":0},{"sm_quantity":"2"}]' }] }), "Completed", "Add").picks, "1");
  eq("mobile: temp_qty_data as an array", gin({ stock_movement: [{ temp_qty_data: [{ sm_quantity: 1 }, { sm_quantity: 2 }] }] }, "Completed", "Add").picks, "2");
  eq("allData as JSON text", gin(JSON.stringify(doc("Edit", ID, 2)), "Completed", "Edit").check, "YES");
  eq("allData missing: passes through", [gin(null, "Completed", "Add").check, gin(null, "Completed", "Add").big], ["NO", "NO"]);
  const busy = "This Item Assembly is being processed in the background - please wait for it to finish.";
  eq("stored Processing, Completed: 400", gst(e, "Processing"), { stored: "Processing", refuse400: "YES", refuse409: "NO", message: busy });
  eq("stored Processing, Draft: 400", gst(gin(doc("Edit", ID, 3), "Draft", "Edit"), "Processing").refuse400, "YES");
  eq("stored Completed, Draft: 409", gst(gin(doc("Edit", ID, 3), "Draft", "Edit"), "Completed"),
    { stored: "Completed", refuse400: "NO", refuse409: "YES", message: "This Item Assembly is already Completed and cannot be saved again." });
  eq("stored Fully Posted, Draft: 409", gst(gin(doc("Edit", ID, 3), "Draft", "Edit"), "Fully Posted").message,
    "This Item Assembly is already Fully Posted and cannot be saved again.");
  eq("stored Completed, Completed: left to the classic (401 / 409)", gst(e, "Completed"), { stored: "Completed", refuse400: "NO", refuse409: "NO", message: "" });
  eq("stored Draft: passes", gst(e, "Draft"), { stored: "Draft", refuse400: "NO", refuse409: "NO", message: "" });
  const eb = gin(doc("Edit", ID, 251), "Completed", "Edit");
  eq("stored Draft, 251 picks: 400 too big", [gst(eb, "Draft").refuse400, gst(eb, "Draft").message], ["YES", eb.bigMessage]);
  eq("stored Processing beats too big", gst(eb, "Processing").message, busy);
  eq("stored row missing: only the cap applies", [gst(e, null).refuse400, gst(e, null).refuse409, gst(eb, null).refuse400], ["NO", "NO", "YES"]);
}

console.log((fails ? "FAILED " + fails : "OK") + " - " + n + " checks" + (skipped.length ? " (SKIPPED " + skipped.length + " prod fixture(s): " + skipped.join(", ") + ")" : ""));
process.exit(fails ? 1 : 0);
