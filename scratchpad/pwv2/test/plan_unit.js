// Unit cases of the plan core on synthetic TOs (no customer data): the request contract, eligibility, the line_index alias,
// split children keyed by the stored line, failures (shortage, unreadable item, lock, changed TO), part chunking, SUBMIT's
// gates. usage: TZ=Asia/Kuala_Lumpur node plan_unit.js
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert0 = require("assert");
// values made inside the vm context carry its prototypes: compare their JSON
const N = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const assert = Object.assign((v, m) => assert0(v, m), assert0, { deepStrictEqual: (a, b, m) => assert0.deepStrictEqual(N(a), N(b), m) });
const D = path.join(__dirname, "..");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const sb = (() => {
  const c = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date };
  vm.createContext(c);
  for (const f of ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js", "code/prepare/chain.js", "code/prepare/plan.js"]) vm.runInContext(fs.readFileSync(path.join(D, f), "utf8"), c, { filename: f });
  vm.runInContext("this.pwPlan = pwPlan; this.pwGates = pwGates; this.PW_CHUNK = PW_CHUNK;", c);
  return c;
})();
const ID = (n) => String(2300000000000000000n + BigInt(n));
const ORG = ID(1);
const PLANT = ID(2);
const TO = ID(3);
const GR = ID(4);
const ITEM = ID(5);
const UOM = ID(6);
const SRC = ID(7);
const BIN = ID(8);
const SL = ID(9);
const J = (o) => ({ j: JSON.stringify(o) });
// a TO with `specs` lines: [{ li, pending, batch, hu, bundle, serial }]
function world(specs, opt) {
  opt = opt || {};
  const hdr = { id: TO, to_status: opt.status || "Created", plant_id: PLANT, to_id: opt.toNo === undefined ? "PA-T-1" : opt.toNo, movement_type: "Putaway", ref_doc_type: "Goods Receiving",
    gr_no: GR, receiving_no: "GR-T-1", organization_id: ORG, tenant_id: "000000", is_deleted: 0, is_processing: opt.processing === undefined ? 1 : opt.processing,
    to_id_type: ID(10), update_time: "2026-10-14 10:00:00.000", create_time: "2026-10-14 09:00:00.000", assigned_to: [] };
  const lines = specs.map((sp, i) => ({
    id: ID(100 + i), line_index: sp.li || String(i + 1), item_code: sp.item || ITEM, item_name: "Item " + (i + 1), item_desc: "desc", batch_no: sp.batch ? ID(200 + i) : null,
    source_inv_category: "In Transit", target_inv_category: "Unrestricted", received_qty: sp.pending, item_uom: UOM, source_bin: SRC, qty_to_putaway: sp.pending,
    pending_process_qty: sp.pending, putaway_qty: 0, target_location: null, remark: "", line_status: "Open", is_split: "No", parent_or_child: "Parent", parent_index: i,
    unit_price: 2.5, total_price: 2.5 * sp.pending, po_no: ID(11), is_serialized_item: sp.serial ? 1 : 0, hu_data: sp.hu ? "{\"hasHuData\":1}" : "", item_bundle_id: sp.bundle ? ID(12) : null,
    storage_location: SL, gr_line_id: ID(300 + i),
  }));
  const transit = specs.map((sp, i) => ({ id: ID(400 + i), doc_type: "Goods Receiving", doc_id: GR, doc_no: "GR-T-1", doc_line_id: ID(300 + i), line_no: i, material_id: sp.item || ITEM,
    item_uom: UOM, batch_id: sp.batch ? ID(200 + i) : null, plant_id: PLANT, organization_id: ORG, transit_bin: SRC, to_plant_id: PLANT, to_category: "Unrestricted",
    transit_qty: opt.transitShort ? sp.pending / 2 : sp.pending, received_qty: 0, open_qty: opt.transitShort ? sp.pending / 2 : sp.pending, status: "In Transit", transit_date: "2026-10-14 09:00:00" }));
  const bbal = specs.filter((sp) => sp.batch).map((sp) => {
    const i = specs.indexOf(sp);
    return { id: ID(500 + i), material_id: sp.item || ITEM, location_id: SRC, batch_id: ID(200 + i), plant_id: PLANT, organization_id: ORG, manufacturing_date: "2026-09-01 00:00:00" };
  });
  const items = opt.noItem ? [] : [{ id: ITEM, based_uom: UOM, item_batch_management: 1, material_costing_method: "First In First Out", serial_number_management: 0, stock_control: 1,
    table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }] }];
  return {
    hdr: [J(hdr)], lines: lines.map(J), records: [], gr: [J({ id: GR, gr_no: "GR-T-1", gr_status: "Received", putaway_status: "Created", organization_id: ORG, plant_id: PLANT })],
    items: items.map(J), transit: transit.map(J), others: [J({ id: TO, to_status: hdr.to_status })], qi: [],
    setup: [J({ id: ID(13), plant_id: PLANT, organization_id: ORG, auto_completed_gr: opt.autoComplete ? 1 : 0, putaway_required: 1 })], bbal: bbal.map(J),
    lock: opt.lockRef === null ? [] : [{ step_name: "LOCK|1", result_ref: opt.lockRef || "KEY" }], _lines: lines,
  };
}
const entry = (lines, extra) => Object.assign({ route: "GO", jobId: ID(900), tenantId: "000000", toId: TO, grId: GR, organizationId: ORG, idempotencyKey: "KEY", nonce: "n0nce123",
  request: Object.assign({ v: 1, source: "FORM", confirmedBy: "Tester", lines: lines }, (extra && extra.request) || {}) }, extra && extra.entry);
const row = (id, qty, more) => Object.assign({ id: id, qty: qty, target_location: BIN, storage_location: SL, target_inv_category: "Unrestricted", remark: "" }, more || {});
const child = (pid, qty, more) => Object.assign({ parent_id: pid, qty: qty, target_location: BIN, storage_location: SL, target_inv_category: "Unrestricted", remark: "" }, more || {});
let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.log("FAIL " + name + ": " + e.message);
    process.exitCode = 1;
  }
};

t("whole lines: pairs, patches, records, ledger, GR", () => {
  const W = world([{ pending: 5, batch: true }, { pending: 3 }]);
  const p = sb.pwPlan(entry([row(ID(100), 5), row(ID(101), 1)]), W);
  assert.strictEqual(p.route, "READY", p.message);
  const P = p.__parts;
  assert.deepStrictEqual(P.ENGINE.movements.map((m) => m.movement_key + ":" + m.direction + ":" + m.location_id + ":" + m.inventory_category),
    ["M1:SUBTRACT:" + SRC + ":In Transit", "M1.2:ADD:" + BIN + ":Unrestricted", "M2:SUBTRACT:" + SRC + ":In Transit", "M2.2:ADD:" + BIN + ":Unrestricted"]);
  const add1 = P.ENGINE.movements[1];
  assert.strictEqual(add1.manufacturing_date, "2026-09-01 00:00:00");
  assert.strictEqual(add1.expired_date, "");
  assert.strictEqual(P.ENGINE.movements[3].manufacturing_date, "");
  assert.ok(!("batch_id" in P.ENGINE.movements[2]), "no batch -> no batch_id");
  assert.strictEqual(P.ENGINE.movements[0].unit_price, 2.5);
  assert.strictEqual(P.ENGINE.movements[0].transaction_type, "TO - PA");
  assert.strictEqual(P.ENGINE.movements[0].trx_no, "PA-T-1");
  assert.strictEqual(P.ENGINE.movements[0].parent_trx_no, "GR-T-1");
  assert.strictEqual(P.ENGINE.movements[0].handling_unit_id, "");
  assert.strictEqual(P.TO.to_status, "In Progress");
  const l1 = P.TO.lines.find((l) => l.id === ID(100));
  // the stored target_location is empty: the reset to '' changes nothing
  assert.deepStrictEqual(l1.after, { pending_process_qty: "0.00000000", line_status: "Completed" });
  const l2 = P.TO.lines.find((l) => l.id === ID(101));
  assert.deepStrictEqual(l2.after, { pending_process_qty: "2.00000000", line_status: "In Progress" });
  assert.deepStrictEqual(l2.before, { pending_process_qty: "3.00000000", line_status: "Open" });
  assert.strictEqual(P.TO.records.length, 2);
  assert.strictEqual(P.TO.records[0].job_line_key, ID(900) + "|1");
  assert.strictEqual(P.TO.records[0].store_in_qty, "5.00000000");
  assert.strictEqual(P.TO.records[0].transfer_order_putaway_id, TO);
  // each line's row closes in place with its first slice; line 2's open remainder becomes a new row
  assert.deepStrictEqual(P.IT.updates.map((u) => u.target_doc_line_id + ":" + u.transit_qty + ":" + u.status), [ID(100) + ":5.00000000:Received", ID(101) + ":1.00000000:Received"]);
  assert.strictEqual(P.IT.updates[0].before.status, "In Transit");
  assert.deepStrictEqual(P.IT.creates.map((c) => c.status + ":" + c.open_qty + ":" + c.source_transit_id + ":" + c.job_line_key), ["In Transit:2.00000000:" + ID(401) + ":" + ID(900) + "|1"]);
  assert.strictEqual(P.GR.putaway_status, "In Progress");
  const m = JSON.parse(p.payload);
  assert.deepStrictEqual(m.counts, { rows: 2, movements: 4, records: 2, lines: 2, itUpdates: 2, itCreates: 1 });
});

t("split: children keyed by the stored line, '<line_index> - n', one parent patch", () => {
  const W = world([{ li: "5", pending: 4 }, { li: "7", pending: 10 }]);
  const p = sb.pwPlan(entry([child(ID(101), 4, { remark: "a" }), child(ID(101), 6, { remark: "b", target_inv_category: "Blocked" })]), W);
  assert.strictEqual(p.route, "READY", p.message);
  const P = p.__parts;
  assert.deepStrictEqual(P.TO.records.map((r) => r.line_index + "/" + r.store_in_qty + "/" + r.remark + "/" + r.target_inv_category),
    ["7 - 1/4.00000000/a/Unrestricted", "7 - 2/6.00000000/b/Blocked"]);
  assert.deepStrictEqual(P.TO.lines.map((l) => l.id), [ID(101)]);
  assert.strictEqual(P.TO.lines[0].after.pending_process_qty, "0.00000000");
  assert.strictEqual(P.ENGINE.movements[3].inventory_category, "Blocked");
  assert.ok(P.IT.updates.every((u) => u.target_doc_line_id === ID(101)), "children carry their line's id");
});

t("lines sharing a line_index: each credited alone (alias), mapped back", () => {
  const W = world([{ li: "1", pending: 1 }, { li: "1", pending: 1 }]);
  const p = sb.pwPlan(entry([row(ID(100), 1)]), W);
  assert.strictEqual(p.route, "READY", p.message);
  const P = p.__parts;
  assert.deepStrictEqual(P.TO.lines.map((l) => l.id + ":" + l.after.pending_process_qty), [ID(100) + ":0.00000000"], "the second line is untouched");
  assert.strictEqual(P.TO.records[0].line_index, "1");
  const both = sb.pwPlan(entry([row(ID(100), 1), row(ID(101), 1)]), world([{ li: "1", pending: 1 }, { li: "1", pending: 1 }]));
  assert.strictEqual(both.route, "READY", both.message + " (the v34 stored check would refuse it keyed on line_index)");
  assert.strictEqual(both.__parts.TO.to_status, "Completed");
});

t("over the stored pending: S8GL6e4o's 400 (stored check)", () => {
  const p = sb.pwPlan(entry([child(ID(100), 3), child(ID(100), 3)]), world([{ pending: 5 }]));
  assert.strictEqual(p.route, "FAIL");
  assert.strictEqual(p.code, "PWC_VALIDATION_400");
  assert.ok(/cannot be greater than the pending quantity \(5\) of line 1/.test(p.message), p.message);
  assert.strictEqual(p.unlockOk, 1);
});

t("no target bin: S8GL6e4o's 400", () => {
  const p = sb.pwPlan(entry([row(ID(100), 1, { target_location: "" })]), world([{ pending: 5 }]));
  assert.strictEqual(p.code, "PWC_VALIDATION_400");
  assert.ok(/Target Location is required/.test(p.message), p.message);
});

t("in-transit shortage: ITmatch's 400, unlock", () => {
  const p = sb.pwPlan(entry([row(ID(100), 4)]), world([{ pending: 4 }], { transitShort: true }));
  assert.strictEqual(p.code, "PWC_VALIDATION_400");
  assert.ok(/Insufficient in-transit quantity/.test(p.message), p.message);
  assert.strictEqual(p.unlockOk, 1);
});

t("unreadable item: refused (the classic would record it and move nothing)", () => {
  const p = sb.pwPlan(entry([row(ID(100), 1)]), world([{ pending: 2 }], { noItem: true }));
  assert.strictEqual(p.code, "PWC_ITEM_NOT_FOUND", p.code + " " + p.message);
});

t("request contract errors", () => {
  const W = world([{ pending: 2 }, { pending: 2 }]);
  const bad = (lines, re) => {
    const p = sb.pwPlan(entry(lines), W);
    assert.strictEqual(p.code, "PWC_INVALID_REQUEST", JSON.stringify(lines) + " -> " + p.code);
    assert.ok(re.test(p.message), p.message);
  };
  bad([], /At least one item/);
  bad([{ id: ID(999), qty: 1 }], /not a line of this putaway/);
  bad([{ id: ID(100), parent_id: ID(100), qty: 1 }], /by id, or its split parent/);
  bad([{ id: ID(100), qty: 0 }], /greater than 0/);
  bad([{ id: ID(100), qty: 1, target_location: "A-1" }], /target_location must be an id/);
  bad([{ id: ID(100), qty: 1 }, { parent_id: ID(100), qty: 1 }], /both put away whole and split/);
  bad([{ id: ID(100), qty: 1 }, { id: ID(100), qty: 1 }], /named twice/);
  bad([{ id: ID(100), qty: 1, target_inv_category: "Lost" }], /unknown target category/);
});

t("not eligible: HU, serial, bundle, draft, too many rows", () => {
  const ne = (W, lines, re) => {
    const p = sb.pwPlan(entry(lines), W);
    assert.strictEqual(p.code, "PWC_NOT_ELIGIBLE", p.code + " " + p.message);
    assert.ok(re.test(p.message), p.message);
  };
  ne(world([{ pending: 1, hu: true }]), [row(ID(100), 1)], /handling units/);
  ne(world([{ pending: 1, serial: true }]), [row(ID(100), 1)], /serial/);
  ne(world([{ pending: 1 }, { pending: 1, bundle: true }]), [row(ID(100), 1)], /bundles/);
  ne(world([{ pending: 1 }], { status: "Draft" }), [row(ID(100), 1)], /Draft/);
  const stored = world([{ pending: 2 }, { pending: 1 }]);
  stored.lines[1] = J(Object.assign(JSON.parse(stored.lines[1].j), { parent_or_child: "Child", line_index: "1 - 1" }));
  ne(stored, [row(ID(100), 1)], /split rows saved/);
  const many = [];
  for (let i = 0; i < 2501; i++) many.push(child(ID(100), 0.001));
  ne(world([{ pending: 5 }]), many, /at most 2500/);
});

t("lock / state refusals", () => {
  const p1 = sb.pwPlan(entry([row(ID(100), 1)]), world([{ pending: 1 }], { lockRef: "OTHER" }));
  assert.strictEqual(p1.code, "PWC_NOT_LOCKED");
  assert.strictEqual(p1.unlockOk, 0, "never release another job's lock");
  const p2 = sb.pwPlan(entry([row(ID(100), 1)]), world([{ pending: 1 }], { processing: 0 }));
  assert.strictEqual(p2.code, "PWC_NOT_LOCKED");
  const p3 = sb.pwPlan(entry([row(ID(100), 1)], { request: { recordedUpdateTime: "2026-10-14 09:59:59.999" } }), world([{ pending: 1 }]));
  assert.strictEqual(p3.code, "PWC_TO_CHANGED");
  assert.strictEqual(p3.unlockOk, 1);
  const p4 = sb.pwPlan(entry([row(ID(100), 1)], { request: { recordedUpdateTime: "2026-10-14 10:00:00.000" } }), world([{ pending: 1 }]));
  assert.strictEqual(p4.route, "READY", p4.message);
  const p5 = sb.pwPlan(entry([row(ID(100), 1)], { entry: { grId: ID(77) } }), world([{ pending: 1 }]));
  assert.strictEqual(p5.code, "PWC_GR_CHANGED");
  const p6 = sb.pwPlan(entry([row(ID(100), 1)]), world([{ pending: 1 }], { status: "Completed" }));
  assert.strictEqual(p6.code, "PWC_TO_COMPLETED");
  const W7 = world([{ pending: 1 }]);
  W7.gr = [J({ id: GR, gr_status: "Processing" })];
  assert.strictEqual(sb.pwPlan(entry([row(ID(100), 1)]), W7).code, "PWC_GR_PROCESSING");
  W7.gr = [];
  assert.strictEqual(sb.pwPlan(entry([row(ID(100), 1)]), W7).code, "PWC_GR_NOT_FOUND");
});

t("auto-complete GR when every TO and QI lot is done", () => {
  const p = sb.pwPlan(entry([row(ID(100), 1)]), world([{ pending: 1 }], { autoComplete: true }));
  assert.strictEqual(p.__parts.GR.putaway_status, "Completed");
  assert.strictEqual(p.__parts.GR.gr_status, "Completed");
});

t("parts: chunked at PW_CHUNK, reassemble to the part", () => {
  const specs = [];
  for (let i = 0; i < 1200; i++) specs.push({ pending: 2, batch: true });
  const W = world(specs);
  const lines = W._lines.map((l) => row(l.id, 2));
  const p = sb.pwPlan(entry(lines), W);
  assert.strictEqual(p.route, "READY", p.message);
  const m = JSON.parse(p.payload);
  for (const [name, steps] of Object.entries(m.parts)) {
    const text = steps.map((st) => p.partRows.find((r) => r.step_name === st).result_ref).join("");
    assert.deepStrictEqual(JSON.parse(text), p.__parts[name], name);
    for (const st of steps) assert.ok(/^P\|n0nce123\|[A-Z]+\|\d{3}$/.test(st), st);
  }
  assert.ok(m.parts.ENGINE.length > 1, "the movements need more than one part");
  assert.ok(p.partRows.every((r) => r.result_ref.length <= sb.PW_CHUNK && r.job_id === ID(900) && r.step_status === "PAYLOAD"));
});

t("SUBMIT gates", () => {
  const W = world([{ pending: 2 }]);
  const S = (hdrPatch, extra) => {
    const h = JSON.parse(W.hdr[0].j);
    Object.assign(h, hdrPatch);
    return Object.assign({ hdr: [Object.assign({ j: JSON.stringify(h) }, extra || {})], lines: W.lines, items: W.items, cost: [] });
  };
  const g = (S0, lines) => sb.pwGates({ request: { lines: lines || [row(ID(100), 2)] }, S: S0, tenantId: "000000" });
  assert.strictEqual(g(S({ is_processing: 0 }, { lock_age_sec: 3, gr_status: "Received" })).route, "GO");
  assert.deepStrictEqual([g(S({ is_processing: 1 }, { lock_age_sec: 30 })).route, g(S({ is_processing: 1 }, { lock_age_sec: 30 })).message], ["STOP", "The current putaway is under processing"]);
  assert.strictEqual(g(S({ is_processing: 1 }, { lock_age_sec: 901 })).route, "GO", "a lock older than 900 s is stale (LockDecide)");
  assert.strictEqual(g(S({ is_processing: 0 }, { gr_status: "Processing" })).message, "The current putaway is under processing");
  assert.strictEqual(g(S({ to_status: "Completed", is_processing: 0 })).message, "The current putaway is already Completed");
  assert.strictEqual(g(S({ is_processing: 0 }), [row(ID(100), 3)]).route, "STOP", "over the stored pending");
  const cost = Object.assign(S({ is_processing: 0 }), { cost: [J({ material_id: ITEM, batch_id: "0", method: "First In First Out", fifo: 0, wa: 2 })] });
  assert.strictEqual(g(cost).route, "GO", "a priced line of a costing-migration item moves (the engine skips its costing rows)");
  const unpriced = Object.assign({}, cost, { lines: cost.lines.map((r) => { const o = JSON.parse(r.j); o.unit_price = 0; return Object.assign({}, r, { j: JSON.stringify(o) }); }) });
  const c = g(unpriced);
  assert.deepStrictEqual([c.route, c.reasons.map((r) => r.code)], ["NOT_ELIGIBLE", ["COSTING"]]);
  const none = sb.pwGates({ request: { lines: [] }, S: { hdr: [], lines: [], items: [], cost: [] } });
  assert.deepStrictEqual([none.route, none.reasons[0].code], ["NOT_ELIGIBLE", "ADD_MODE"]);
});

console.log(`plan_unit: ${passed} passed` + (process.exitCode ? ", FAILURES above" : ""));
