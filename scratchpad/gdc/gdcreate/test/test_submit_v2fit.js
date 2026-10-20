// test_submit_v2fit.js <request.json>: GD_ASYNC_SUBMIT's V2 fit. Unit checks of the shared library (v2fit_lib.js) and of the
// two new code nodes, a drift guard on the GD_BULK_PREPARE source lines the library mirrors, then the patched workflow on the
// interpreter (repo Goods Delivery/AsyncV2/, every read mocked, writes recorded). Nothing touches a database.
const fs = require("fs"), assert = require("assert");
const { Engine } = require("../../pkv2tools/sim/engine");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const REQ = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const LIB = fs.readFileSync(__dirname + "/../code/v2fit_lib.js", "utf8");
const lib = Function(LIB + "\nreturn { gdV2FitLines, gdV2Fit };")();
const node = (file, subs) => {
  let src = fs.readFileSync(__dirname + "/../code/" + file, "utf8").replace("@@GDV2_FIT@@\n", LIB);
  for (const [k, v] of Object.entries(subs)) src = src.split("{{" + k + "}}").join(JSON.stringify(v));
  assert.ok(!/\{\{[^}]+\}\}/.test(src), "unsubstituted placeholder in " + file);
  return Function(src)();
};
let n = 0;
const t = (name, f) => { f(); n++; console.log("ok", name); };
const ITEM = (id, over) => Object.assign({ kind: "ITEM", id: id, f1: "1", f2: "First In First Out", f3: "0", f4: "0", f5: "10.0000" }, over || {});
const fit = (payload, facts) => lib.gdV2Fit(lib.gdV2FitLines(payload).rows, facts);
const line = (over) => Object.assign({ material_id: "11", so_line_item_id: "91", gd_qty: "2", temp_qty_data: [] }, over || {});

t("lines: flat walk (bundle row, its items), auto = no allocation + a quantity, handling-unit allocations, id lists", () => {
  const p = { lines: [
    line(),
    line({ material_id: "12", so_line_item_id: "92", temp_qty_data: [{ location_id: "5", gd_quantity: "2", handling_unit_id: "77" }] }),
    { material_id: "", item_bundle_id: "300", so_line_item_id: "93", gd_qty: "1", temp_qty_data: [], children: [line({ material_id: "13", so_line_item_id: "" }), line({ material_id: "14", so_line_item_id: "", temp_qty_data: '[{"location_id":"5","gd_quantity":"2"}]' })] },
    line({ material_id: "15", gd_qty: "0" }),
    line({ material_id: "16", temp_qty_data: '[{"location_id":"5","gd_quantity":"2","hu_id":"8"}]' }),
  ] };
  const f = lib.gdV2FitLines(p);
  assert.deepStrictEqual(f.rows, [["1", "11", "91", 1, 0], ["2", "12", "92", 0, 1], ["3", "", "93", 0, 0], ["3/1", "13", "", 1, 0], ["3/2", "14", "", 0, 0], ["4", "15", "91", 0, 0], ["5", "16", "91", 0, 1]]);
  assert.deepStrictEqual(f.materialIds.sort(), ["11", "12", "13", "14", "15", "16"]);
  assert.deepStrictEqual(f.autoMaterialIds.sort(), ["11", "13"]);
  assert.deepStrictEqual(f.soLineIds.sort(), ["91", "92", "93"]);
  assert.deepStrictEqual(lib.gdV2FitLines(null), { rows: [], materialIds: [], autoMaterialIds: [], soLineIds: [] });
  assert.deepStrictEqual(lib.gdV2FitLines({ lines: [line({ material_id: "1' OR '1'='1", so_line_item_id: "x" })] }).rows, [["1", "", "", 0, 0]], "a non-digit id never reaches a list");
});

t("fit: item master flags exactly as PREPARE reads them (J5T1G2s9)", () => {
  const p = { lines: [line()] };
  assert.strictEqual(fit(p, [ITEM("11")]), "");
  assert.strictEqual(fit(p, []), "", "no item row: PREPARE reports it, not a classic case");
  assert.ok(/not stock-controlled/.test(fit(p, [ITEM("11", { f1: "0" })])));
  assert.ok(/not stock-controlled/.test(fit(p, [ITEM("11", { f1: "" })])), "NULL stock_control");
  assert.ok(/costing method ''/.test(fit(p, [ITEM("11", { f2: "" })])));
  assert.ok(/costing method 'FIFO'/.test(fit(p, [ITEM("11", { f2: "FIFO" })])));
  assert.strictEqual(fit(p, [ITEM("11", { f2: "Weighted Average" })]), "");
  assert.ok(/batch management ''/.test(fit(p, [ITEM("11", { f3: "" })])));
  assert.strictEqual(fit(p, [ITEM("11", { f3: "1" })]), "");
  assert.ok(/serial number management '1'/.test(fit(p, [ITEM("11", { f4: "1" })])));
  assert.ok(/serial number management ''/.test(fit(p, [ITEM("11", { f4: "" })])), "NULL serial: PREPARE's String(null) !== '0'");
  const fixed = (price) => fit(p, [ITEM("11", { f2: "Fixed Cost", f5: price })]);
  assert.strictEqual(fixed("12.5000"), "");
  assert.strictEqual(fixed("0"), "");
  assert.strictEqual(fixed("-0.00"), "", "-0 is not negative");
  assert.ok(/Fixed Cost without a usable purchase price/.test(fixed("")));
  assert.ok(/Fixed Cost without a usable purchase price/.test(fixed("-1.5")));
  assert.ok(/Fixed Cost without a usable purchase price/.test(fixed("1.000000001")), "a 9th fraction digit: PREPARE's dec8 reads null");
  assert.strictEqual(fixed("1.000000000"), "", "trailing zeros past 8 digits are readable");
  assert.strictEqual(fit(p, [ITEM("11", { f5: "" })]), "", "the price matters only for Fixed Cost");
});

t("fit: handling units (Auto mode, auto lines only; any handling-unit allocation) and pending reservations", () => {
  const p = { lines: [line()] };
  const HU = { kind: "HU", id: "11" };
  assert.ok(/handling units in this plant hold material 11/.test(fit(p, [HU])), "no setup row = the defaults (Auto)");
  assert.ok(/handling units/.test(fit(p, [{ kind: "SETUP", id: "1", f1: "Auto" }, HU])));
  assert.strictEqual(fit(p, [{ kind: "SETUP", id: "1", f1: "Manual" }, HU]), "", "Manual: PREPARE allocates nothing");
  assert.strictEqual(fit(p, [{ kind: "SETUP", id: "1", f1: "" }, HU]), "", "a setup row with no mode = Manual");
  assert.strictEqual(fit({ lines: [line({ temp_qty_data: [{ location_id: "5", gd_quantity: "2" }] })] }, [HU]), "", "Select Stock: no auto allocation");
  assert.ok(/stock picked from a handling unit/.test(fit({ lines: [line({ temp_qty_data: [{ location_id: "5", gd_quantity: "2", handling_unit_id: "7" }] })] }, [{ kind: "SETUP", f1: "Manual" }])));
  assert.ok(/sales order line 91 carries a pending reservation/.test(fit(p, [{ kind: "PEND", id: "91" }])));
  assert.strictEqual(fit(p, [{ kind: "PEND", id: "92" }, { kind: "HU", id: "12" }]), "", "facts of other lines change nothing");
  assert.ok(/line 3\/1: handling units/.test(fit({ lines: [line({ material_id: "1" }), line({ material_id: "2" }), { item_bundle_id: "300", material_id: "", gd_qty: "1", children: [line({ material_id: "11" })] }] }, [HU])), "a bundle item is labelled <row>/<item>");
  assert.strictEqual(fit(p, ITEM("11")), "", "a count=1 read arrives as one object");
  assert.strictEqual(fit(p, null), "");
});

t("drift guard: the GD_BULK_PREPARE v17 source lines the library mirrors are still there", () => {
  const prep = fs.readFileSync(R + "Goods Delivery/AsyncV2/GD_BULK_PREPARE.json", "utf8");
  for (const needle of [
    'const METHOD = { \\"Fixed Cost\\": \\"FIXED_COST\\", \\"First In First Out\\": \\"FIFO\\", \\"Weighted Average\\": \\"WEIGHTED_AVERAGE\\" };',
    'if (String(it.stock_control) !== \\"1\\") {',
    'if ([\\"0\\", \\"1\\"].indexOf(String(it.item_batch_management)) < 0) {',
    'if (String(it.serial_number_management) !== \\"0\\") {',
    'if (s(it.material_costing_method) === \\"Fixed Cost\\" && (D.parse(it.purchase_unit_price) === null || D.parse(it.purchase_unit_price) < 0n)) {',
    "if (a.hu_id) {",
    "const hu = s(x.handling_unit_id) || s(x.hu_id);",
    "if (pending[line.so_line_id]) {",
    "if (hu[s(currentRow.materialId)]) {",
    'if ((effectiveSetup.picking_mode || \\"Manual\\") !== \\"Auto\\") {',
    "if (!bundle && !outAllocs.length && qu !== null && qu > 0n && ID.test(materialId)) {",
    "AND (h.packing_id IS NULL OR h.packing_id = '') AND hi.material_id IN ({{node:code_node_FniXEIuQ.data.autoMaterialIdsSql}})",
    "AND r.status = 'Pending'",
  ]) assert.ok(prep.includes(needle), "PREPARE changed, re-check the fit library: " + needle);
});

t("plan node: compact lines + digits-only ids; quoted sales order lines; nothing usable = matches nothing", () => {
  const g = (over) => Object.assign({ tenantId: "496474", organizationId: "2105190589240086530", plantId: "2105200506810306561", payloadText: JSON.stringify({ lines: [line(), line({ material_id: "12", so_line_item_id: "92", temp_qty_data: [{ location_id: "5", gd_quantity: "2" }] })] }) }, over || {});
  const sub = (x) => ({ "node:code_node_EluyWNR5.data.tenantId": x.tenantId, "node:code_node_EluyWNR5.data.organizationId": x.organizationId, "node:code_node_EluyWNR5.data.plantId": x.plantId, "node:code_node_EluyWNR5.data.payloadText": x.payloadText });
  let r = node("fit_plan.js", sub(g()));
  assert.deepStrictEqual(JSON.parse(r.linesJson), [["1", "11", "91", 1, 0], ["2", "12", "92", 0, 0]]);
  assert.deepStrictEqual([r.tenantSql, r.orgSql, r.plantSql, r.materialIdsSql, r.autoMaterialIdsSql, r.soLineIdsSql], ["496474", "2105190589240086530", "2105200506810306561", "11,12", "11", "'91','92'"]);
  r = node("fit_plan.js", sub(g({ organizationId: "1' OR '1'='1", plantId: "2 OR 1=1", tenantId: "x", payloadText: "not json" })));
  assert.deepStrictEqual([r.tenantSql, r.orgSql, r.plantSql, r.materialIdsSql, r.autoMaterialIdsSql, r.soLineIdsSql, r.linesJson], ["0", "0", "0", "0", "0", "'0'", "[]"]);
});

t("decision node: only a new save (CREATE) with a reason is refused, and it carries the answer fields", () => {
  const d = (route, facts) => node("fit_decide.js", { "node:code_node_EluyWNR5.data.idempotencyKey": "K1", "node:code_node_EluyWNR5.data.payloadHash": "H1", "node:code_node_iJTFTwP3.data.route": route,
    "node:code_node_GSfitPlan.data.linesJson": JSON.stringify([["1", "11", "91", 1, 0]]), "node:sql_node_GSfit.data": facts });
  const r = d("CREATE", [{ kind: "PEND", id: "91" }]);
  assert.deepStrictEqual([r.route, r.result_code, r.created, r.job_id, r.idempotency_key, r.payload_hash, r.line_errors], ["CLASSIC", "GD_V2_USE_CLASSIC", "NO", "", "K1", "H1", "[]"]);
  assert.strictEqual(r.result_message, "This delivery needs the classic save: line 1: sales order line 91 carries a pending reservation.");
  assert.strictEqual(JSON.parse(r.evidence).path, "USE_CLASSIC");
  for (const route of ["CONFIRM", "RETURN", "REJECT", ""]) assert.strictEqual(d(route, [{ kind: "PEND", id: "91" }]).route, "GO", route);
  assert.strictEqual(d("CREATE", []).route, "GO");
  assert.strictEqual(d("CREATE", null).result_code, "");
});

// the patched workflow on the interpreter
const run = (o) => {
  const writes = [];
  let fitSql = "";
  const e = new Engine({
    dir: R + "Goods Delivery/AsyncV2",
    db: { tenantId: "711077", insert: (tb, rows) => { writes.push("insert " + tb); return rows.map((r, i) => Object.assign({ id: String(7000 + i) }, r)); }, update: (tb, rows) => { writes.push("update " + tb); return rows.length; } },
    mocks: {
      sql: {
        sql_node_GZBo7WZi: () => [Object.assign({ db_now: "2026-10-20 10:00:00" }, o.existing || {})],
        sql_node_GSsoBusy: () => o.others || [],
        sql_node_GSfit: (text) => { fitSql = text; return o.facts || []; },
        sql_node_mhbRT14u: () => [{ id: o.existing ? o.existing.id : "7000", job_status: o.existing ? o.existing.job_status : "QUEUED", idempotency_key: REQ.idempotency_key, payload_hash: o.existing ? o.existing.payload_hash : "", gd_id: "", gd_no: "", is_deleted: 0, row_version: 0, progress_message: "" }],
      },
      read: {},
    },
  });
  e.injectJs = (text, ctx) => text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => { const v = e.resolve(ref, ctx); return v === undefined ? "null" : JSON.stringify(v); });
  const r = e.run("GD_ASYNC_SUBMIT", Object.assign({}, REQ, o.confirm ? { confirmation_hash: "c".repeat(64) } : {}));
  return { out: r.returned || {}, writes, fitSql };
};
const L0 = JSON.parse(REQ.payload).lines[0];
const MAT = String(L0.material_id), SOL = String(L0.so_line_item_id);

t("workflow: nothing in the way -> queued (one insert); the fit read asked for exactly this save's ids, tenant-scoped", () => {
  const r = run({ facts: [ITEM(MAT)] });
  assert.strictEqual(r.out.result_code, "", JSON.stringify(r.out));
  assert.deepStrictEqual(r.writes, ["insert GD Async Job"]);
  assert.ok(r.fitSql.includes("AND i.id IN (" + MAT + ")"), r.fitSql);
  assert.ok(r.fitSql.includes("AND hi.material_id IN (" + MAT + ")"));
  assert.ok(r.fitSql.includes("AND r.parent_line_id IN ('" + SOL + "')"));
  assert.ok(r.fitSql.includes("AND i.tenant_id = '711077'") && r.fitSql.includes("p.organization_id = '" + REQ.organization_id + "'"));
  assert.ok(r.fitSql.includes("AND h.plant_id = " + REQ.plant_id));
});
for (const [label, facts, re] of [
  ["handling-unit stock of the auto line's material", [{ kind: "HU", id: MAT }], /handling units in this plant hold material/],
  ["a pending reservation on its sales order line", [{ kind: "PEND", id: SOL }], /pending reservation/],
  ["a serial-managed item (NULL)", [ITEM(MAT, { f4: "" })], /serial number management/],
]) {
  t("workflow: " + label + " -> GD_V2_USE_CLASSIC, nothing written", () => {
    const r = run({ facts });
    assert.strictEqual(r.out.result_code, "GD_V2_USE_CLASSIC", JSON.stringify(r.out));
    assert.ok(re.test(r.out.result_message), r.out.result_message);
    assert.deepStrictEqual([r.out.job_id, r.out.created], ["", "NO"]);
    assert.deepStrictEqual(r.writes, []);
  });
}
// the payload hash SUBMIT computes for this request: an existing job of the same save carries it (a KEY_REUSED answer echoes it)
const HASH = run({ existing: { id: "1", idempotency_key: REQ.idempotency_key, job_status: "QUEUED", payload_hash: "other", is_deleted: 0 } }).out.payload_hash;
assert.ok(/^[0-9a-f]{64}$/.test(HASH), HASH);
t("workflow: the same save resubmitted (its job exists) is answered as before, never sent to classic", () => {
  const r = run({ existing: { id: "7001", idempotency_key: REQ.idempotency_key, job_status: "VALIDATING", payload_hash: HASH, confirmation_hash: "", is_deleted: 0, row_version: 1 }, facts: [{ kind: "HU", id: MAT }] });
  assert.strictEqual(r.out.result_code, "", JSON.stringify(r.out));
  assert.strictEqual(r.out.job_id, "7001");
  assert.deepStrictEqual(r.writes, []);
});
t("workflow: a confirmation (CONFIRM) of a job PREPARE accepted is never sent to classic", () => {
  const waiting = { id: "7002", idempotency_key: REQ.idempotency_key, job_status: "AWAITING_CONFIRMATION", payload_hash: HASH, confirmation_hash: "", is_deleted: 0, row_version: 2 };
  const e = run({ existing: waiting, facts: [{ kind: "PEND", id: SOL }], confirm: true });
  assert.strictEqual(e.out.result_code, "", JSON.stringify(e.out));
  assert.deepStrictEqual(e.writes, ["update GD Async Job"]);
});
t("workflow: another unfinished save of the order wins over the classic answer (a classic save would double it)", () => {
  const r = run({ others: [{ job_id: "2111000000000000001", job_status: "READY_TO_COMMIT", source_so_no: "SO/1" }], facts: [{ kind: "HU", id: MAT }] });
  assert.strictEqual(r.out.result_code, "GD_SO_SAVE_RUNNING");
  assert.deepStrictEqual(r.writes, []);
});
console.log(n + " passed");
