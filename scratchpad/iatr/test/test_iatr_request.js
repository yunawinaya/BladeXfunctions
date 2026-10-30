// IA_TRANSFER_REQUEST v8 (scratchpad/iatr/build_iatr.py; RESERVED_REQUEST_PLAN.md Task 7) run whole on the iav2 sim engine: the reads
// mocked in their SQL's shape, every add / update and the engine call recorded; the claims and the read-back come from the run's own
// writes (an honest platform) unless a case overrides them.
//   CREATE (a Created IA): one claim, the request (Requested, 'issued' + the rule, its lines and starting picks from the IA's RES-01
//   reservation), the IA link, the claim freed; the setup off, a Draft IA, nothing reserved and every other refusal answer before any
//   write; a lost claim frees itself, 409; an unconfirmed read-back 500. REFRESH: the lines / picks / fingerprint / revision / log from
//   the reservation now. REPLACE: after a receipt, from the new reservation, linked to the received request, to its staging bin.
//   DEFECT: the engine's Reserved -> Blocked (one operation per click), then the reservation rows, the IA lines, the received request's
//   log; an engine refusal writes nothing more. CANCEL: Cancelled, the IA keeps its reservation. STATUS: no write.
//   node scratchpad/iatr/test/test_iatr_request.js   (IATR_REQUEST=<file> runs another build: mutants_iatr_request.js)
const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.join(__dirname, "..", "..", "..");
const { Engine } = require(path.join(REPO, "scratchpad", "iav2", "lib", "sim", "engine.js"));
const FILE = process.env.IATR_REQUEST || path.join(REPO, "Item Assembly & BOM", "TransferRequest", "IA_TRANSFER_REQUEST.json");
const WF = JSON.parse(fs.readFileSync(FILE, "utf8"));
const SHARED = path.join(__dirname, "..", "code", "shared");
const strip = (t) => t.split("\n").filter((l) => !l.startsWith("if (typeof module")).join("\n");
const R = new Function(["iatr_rules.js", "iatr_ia.js", "iatr_reserve.js", "iatr_ia2.js"].map((f) => strip(fs.readFileSync(path.join(SHARED, f), "utf8"))).join("\n")
  + "\nreturn { iatrIaFp, iatrBasis, iatrHash, rrReqFp, rrLinesFromHolds };")();

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1500) + "\n  want " + JSON.stringify(want).slice(0, 1500));
};
const yes = (label, v) => eq(label, !!v, true);

const T = "711077", UID = "2105190590557097986", IA = "2113088440365826050", ORG = "2105190589240086530", PLANT = "2105200506810306561";
const SL = "2105223032261218305", BIN = "2106278340907413505", RULE = "2105200574229549070", LOTID = "2114100000000000001", RECV = "2114100000000000002";
const W1 = "2106278340907413601", W2 = "2106278340907413602";
const M1 = "2105486802904584218", M2 = "2105486802904584219", LAB = "2105486802904584220", UOM = "2105486663217483803";
const L1 = "2113088440449712130", L2 = "2113088440449712131", L3 = "2113088440449712132";
const NOW = "2026-10-30 12:00:00";
const ia = (o) => Object.assign({ id: IA, status: "Created", hold: "FULL", plant: PLANT, org: ORG, no: "IA-2610-030", item_id: "2105489399707242504", item_qty: 2,
  planned_output_qty: null, bom_consumption_mode: null, source_bom_id: "" }, o || {});
const pk = (m, bin, qty, o) => Object.assign({ material_id: m, location_id: bin, storage_location_id: null, batch_id: null, balance_id: "77" + bin.slice(-6), sm_quantity: qty,
  category: "Unrestricted", plant_id: PLANT, organization_id: ORG, is_deleted: 0, expired_date: null, manufacturing_date: null, unrestricted_qty: 9, balance_quantity: 9 }, o || {});
const lines = () => [
  { id: L1, item_selection: M1, item_name: "Thrust Washer", quantity_uom: UOM, requested_qty: 1, required_qty: 1, sc_ref_key: "", line_index: "1",
    temp_qty_data: JSON.stringify([pk(M1, W1, 1)]), temp_hu_data: "" },
  { id: L2, item_selection: M2, item_name: "Bolt M8", quantity_uom: UOM, requested_qty: 4, required_qty: null, sc_ref_key: "", line_index: "2",
    temp_qty_data: JSON.stringify([pk(M2, W1, 3), pk(M2, W2, 1)]), temp_hu_data: "" },
  { id: L3, item_selection: LAB, item_name: "Direct Labour", quantity_uom: UOM, requested_qty: 1, required_qty: null, sc_ref_key: "", line_index: "3", temp_qty_data: "", temp_hu_data: "" },
];
const items = [{ id: M1, stock_control: 1, serial_number_management: 0, material_name: "Thrust Washer", material_code: "0101-014000-48", material_desc: "" },
  { id: M2, stock_control: 1, serial_number_management: 0, material_name: "Bolt M8", material_code: "B8", material_desc: "zinc" },
  { id: LAB, stock_control: 0, serial_number_management: 0, material_name: "Direct Labour", material_code: "DL", material_desc: "" }];
const unit = { create_dept: ORG, create_time: "2026-10-01 10:35:13.218", create_user: UID, id: UOM, is_deleted: 0, organization_id: ORG, sub_tenant_id: null,
  tenant_id: T, uom_name: "PCS", update_time: "2026-10-01 10:35:13.218", update_user: UID };
const uoms = () => [{ item: M1, row: unit }, { item: M2, row: unit }];
const hold = (id, line, m, bin, qty, o) => Object.assign({ id: id, status: "Allocated", doc_line_id: line, material_id: m, bin_location: bin, batch_id: null,
  from_category: "Unrestricted", open_qty: String(qty), reserved_qty: String(qty), item_uom: UOM, job_line_key: "" }, o || {});
const holds = () => [hold("2115000000000000001", L1, M1, W1, 1), hold("2115000000000000002", L2, M2, W1, 3), hold("2115000000000000003", L2, M2, W2, 1)];
const ON = [{ organization_id: ORG, plant_id: PLANT, transfer_request_enabled: 1, is_deleted: 0 }];
const OFF = [{ organization_id: ORG, plant_id: PLANT, transfer_request_enabled: 0, is_deleted: 0 }];
const itemMap = {};
for (const it of items) itemMap[it.id] = it;
const fpIa = (h, l) => R.iatrIaFp(R.iatrBasis(h), l);
const fpReq = (h, bin) => R.rrReqFp(R.rrLinesFromHolds(lines(), h, itemMap, bin).lines);
const J = (o, bare) => {
  const t = JSON.stringify(o);
  return [{ j: bare ? t.replace(/"([0-9]{19})"/g, "$1") : t }];
};

class Sim extends Engine {
  constructor(sc) {
    const writes = [];
    const calls = [];
    const sqls = {};
    const db = {
      tenantId: T, uid: sc.uid === undefined ? UID : sc.uid,
      insert: (table, rows) => rows.map((r0, i) => {
        const r = Object.assign({}, r0, { id: String(2114200000000000001n + BigInt(writes.length + i)) });
        writes.push(["insert", table, r]);
        return r;
      }),
      update: (table, rows) => {
        rows.forEach((r) => writes.push(["update", table, r]));
        return { count: rows.length };
      },
    };
    const held = () => writes.filter((w) => w[0] === "insert" && w[1] === "GD Publish Step").map((w) => ({ id: w[2].id, name: w[2].step_name, started_at: w[2].started_at }))
      .filter((c) => !writes.some((u) => u[0] === "update" && u[1] === "GD Publish Step" && u[2].__id === c.id && u[2].step_status === "FREE"));
    const lotNow = () => {
      // the platform's request after the run's writes: an insert numbered, an update applied over the scenario's named request
      const add = writes.filter((w) => w[0] === "insert" && w[1] === "Location Transfer")[0];
      if (add) {
        return { id: add[2].id, no: "LOT-20261030/0007", status: add[2].stock_movement_status, fp: add[2].source_ia_fp, rev: add[2].source_ia_rev, purpose: add[2].transfer_purpose,
          source: add[2].source_ia_id, job: "", lines: add[2].stock_movement.map((l, i) => ({ id: "2114300000000000" + (100 + i), source_ia_line_id: l.source_ia_line_id,
            requested_qty: Number(l.requested_qty) })) };
      }
      const base = sc.named ? JSON.parse(JSON.stringify(sc.named)) : null;
      if (!base) return null;
      const upd = writes.filter((w) => w[0] === "update" && w[1] === "Location Transfer" && w[2].__id === base.id).map((w) => w[2]);
      const lot = { id: base.id, no: base.no, status: base.status, fp: base.fp, rev: base.rev, purpose: base.purpose, source: base.source, job: "", lines: base.lines };
      for (const u of upd) {
        if (u.stock_movement_status !== undefined) lot.status = u.stock_movement_status;
        if (u.source_ia_fp !== undefined) lot.fp = u.source_ia_fp;
        if (u.source_ia_rev !== undefined) lot.rev = u.source_ia_rev;
        if (u.stock_movement !== undefined) lot.lines = u.stock_movement.map((l, i) => ({ id: "2114400000000000" + (100 + i), source_ia_line_id: l.source_ia_line_id, requested_qty: Number(l.requested_qty) }));
      }
      return lot;
    };
    // the IA's reservation rows and lines after the run's writes (DEFECT's read-back)
    const after = (table, rows) => rows.map((r0) => Object.assign({}, r0, ...writes.filter((w) => w[0] === "update" && w[1] === table && w[2].__id === r0.id).map((w) => {
      const o = Object.assign({}, w[2]);
      delete o.__id;
      return o;
    })));
    const rec = (id, f) => (text) => {
      sqls[id] = text;
      return f(text);
    };
    super({
      dir: os.tmpdir(), db,
      mocks: {
        sql: {
          sql_node_TRia: rec("ia", () => J({ ia: sc.ia === undefined ? ia() : sc.ia, lines: sc.lines || lines(), items: items, uoms: uoms(), holds: sc.holds || holds(),
            uomNames: [{ id: UOM, uom_name: "PCS" }], binNames: [{ id: BIN, name: "PROD-01" }, { id: W1, name: "A1-01" }], batchNos: [] }, sc.bare)),
          sql_node_TRreq: rec("req", () => J({ reqs: sc.reqs || [], named: sc.named || null }, sc.bare)),
          sql_node_TRdest: rec("dest", () => J({ sl: { id: SL, plant: PLANT, active: 1, name: "PRODUCTION" }, bin: Object.assign({ id: BIN, plant: PLANT, sl: SL, active: 1, name: "PROD-01" },
            sc.bin || {}), rule: RULE }, sc.bare)),
          sql_node_TRwho: rec("who", () => J({ member: sc.member === undefined ? 1 : sc.member, user: "Production Planner", max: sc.max || 0, now: NOW,
            setup: sc.setup === undefined ? ON : sc.setup })),
          sql_node_TRclaims: rec("claims", () => J({ claims: (sc.otherClaims || []).concat(held()), status: sc.iaNow || "Created",
            reqs: (sc.reqsNow || sc.reqs || []).map((r) => ({ id: r.id, status: r.status })), openJobs: 0, now: NOW })),
          sql_node_TRback: rec("back", () => J(sc.back !== undefined ? sc.back : { lot: lotNow(), holds: after("On Reserved Goods Delivery", sc.holds || holds()),
            lines: after("Stock movement(Item Assembly)", sc.lines || lines()) })),
        },
        read: {},
      },
    });
    this.writes = writes;
    this.calls = calls;
    this.sqls = sqls;
    this.engineAnswer = sc.engine || { code: "200", result_code: "", message: "applied" };
  }

  run(name, params) {
    if (name === "INVENTORY_BULK_APPLY") {
      this.calls.push(params);
      return { returned: this.engineAnswer };
    }
    return super.run(name, params);
  }

  load(name) {
    if (name === "IA_TRANSFER_REQUEST") return WF;
    throw new Error("no workflow " + name);
  }
}
const go = (params, sc) => {
  const s = new Sim(sc || {});
  let r;
  try {
    r = s.run("IA_TRANSFER_REQUEST", params);
  } catch (e) {
    r = { returned: { crashed: String(e.message).slice(0, 400) } };
  }
  const ret = r.returned || {};
  let result = {};
  try {
    result = JSON.parse(ret.result_json || "{}");
  } catch (e) {
    result = { unreadable: ret.result_json };
  }
  return { code: ret.code, message: ret.message, result: result, crashed: ret.crashed, writes: s.writes, calls: s.calls, sqls: s.sqls, out: (r.ctx && r.ctx.out) || {} };
};
const create = (o) => Object.assign({ operation: "CREATE", ia_id: IA, organization_id: ORG, expected_fp: fpIa(ia(), lines()), storage_location_id: SL, location_id: BIN,
  required_date: "2026-10-30", idempotency_key: "IATR:" + IA + ":k1" }, o || {});
const of = (r, table, kind) => r.writes.filter((w) => w[1] === table && (!kind || w[0] === kind)).map((w) => w[2]);
const quiet = (label, rr, code, re) => {
  eq(label + ": " + code, rr.code, code);
  yes(label + ": its message (" + rr.message + ")", re.test(rr.message || ""));
  eq(label + ": nothing written", rr.writes.length, 0);
};

// ================================================================ CREATE (a Created IA: its reservation)
let r = go(create());
eq("CREATE: 200, the number in the message", [r.code, r.message, r.crashed], ["200", "Transfer request LOT-20261030/0007 created.", undefined]);
eq("  writes in order: claim, request, IA link, claim freed", r.writes.map((w) => w[0] + " " + w[1]),
  ["insert GD Publish Step", "insert Location Transfer", "update Item Assembly", "update GD Publish Step"]);
const claim = of(r, "GD Publish Step", "insert")[0];
eq("  the claim", [claim.job_id, claim.step_name, claim.step_status, claim.result_ref], ["IATR|" + IA, "CLAIM|1", "HELD", "IATR:" + IA + ":k1|CREATE"]);
const lot = of(r, "Location Transfer", "insert")[0];
eq("  the request header", [lot.stock_movement_status, lot.issuing_operation_faci, lot.stock_movement_no, lot.stock_movement_no_type, lot.transfer_purpose, lot.source_ia_id,
  lot.source_ia_no, lot.source_ia_rev, lot.replaces_id, lot.replacement_for_id], ["Requested", PLANT, "issued", RULE, "IA_SUPPLY", IA, "IA-2610-030", "1", "", ""]);
eq("  its fingerprint: the reservation it was made from (RR1)", lot.source_ia_fp, fpReq(holds(), BIN));
eq("  its lines: the 2 reserved stock lines, Requested = Selected = the reservation, at the destination", lot.stock_movement.map((l) => [l.item_selection, l.requested_qty,
  l.total_quantity, l.storage_location_id, l.location_id, l.source_ia_line_id, l.uom_options.length]),
[[M1, "1.00000000", "1.00000000", SL, BIN, L1, 1], [M2, "4.00000000", "4.00000000", SL, BIN, L2, 1]]);
eq("  their picks start at the reserved bins, with the IA's balance ids", lot.stock_movement.map((l) => JSON.parse(l.temp_qty_data).map((p) => [p.location_id, p.sm_quantity, p.balance_id])),
  [[[W1, 1, "77413601"]], [[W1, 3, "77413601"], [W2, 1, "77413602"]]]);
eq("  its log: one CREATE entry", JSON.parse(lot.request_log).map((e) => [e.op, e.by, e.uid, e.rev, e.lines, e.claim]), [["CREATE", "Production Planner", UID, 1, 2, "CLAIM|1"]]);
eq("  the IA linked to it", [of(r, "Item Assembly")[0].__id, of(r, "Item Assembly")[0].transfer_request_id], [IA, lot.id]);
const freed = of(r, "GD Publish Step", "update")[0];
eq("  our claim freed, done", [freed.__id, freed.step_status, freed.finished_at, freed.result_ref], [claim.id, "FREE", NOW, "DONE|IATR:" + IA + ":k1"]);
eq("  the reads: the reservation and the setup; no DEFECT parts", [/'YES' = 'YES' AND r\.tenant_id = '711077' AND r\.organization_id = '2105190589240086530'/.test(r.sqls.ia),
  /r\.doc_id = '2113088440365826050' AND r\.status = 'Allocated'/.test(r.sqls.ia), /'NO' = 'YES' AND u\.id IN/.test(r.sqls.ia),
  /FROM item_assembly_setup s WHERE s\.tenant_id = '711077' AND s\.organization_id = '2105190589240086530'/.test(r.sqls.who), /IF\('NO' = 'YES', g\.request_log/.test(r.sqls.req)],
  [true, true, true, true, true]);
eq("CREATE: the reads' ids as bare numbers -> the same request", [go(create(), { bare: true }).code], ["200"]);
eq("CREATE: the next claim number after the IA's highest ever", of(go(create(), { max: 6 }), "GD Publish Step", "insert")[0].step_name, "CLAIM|7");
r = go(create(), { reqs: [{ id: "2114000000000000003", no: "LOT-3", status: "Cancelled", rev: 1, fp: "x", sl: SL, bin: BIN }] });
eq("CREATE: after a cancelled request -> it replaces that one", [r.code, of(r, "Location Transfer")[0].replaces_id], ["200", "2114000000000000003"]);
r = go(create(), { holds: [hold("2115000000000000001", L1, M1, W1, 1)] });
eq("CREATE partial (D1): only what is reserved; the log names the rest", [r.code, of(r, "Location Transfer")[0].stock_movement.map((l) => l.source_ia_line_id),
  JSON.parse(of(r, "Location Transfer")[0].request_log)[0].skipped.map((x) => x.line)], ["200", [L1], [L2]]);

quiet("CREATE: an invalid operation", go(create({ operation: "DELETE" })), "400", /operation/);
quiet("CREATE: no destination bin", go(create({ location_id: "" })), "400", /location_id/);
quiet("CREATE: no IA fingerprint", go(create({ expected_fp: "" })), "400", /expected_fp/);
quiet("CREATE: no session user", go(create(), { uid: "" }), "400", /session user/);
quiet("CREATE: not a member", go(create(), { member: 0 }), "400", /not assigned/);
quiet("CREATE: an IA of another organisation", go(create({ organization_id: "2105190589240086999" })), "400", /not assigned/);
quiet("CREATE: the IA gone", go(create(), { ia: null }), "400", /not found/);
quiet("CREATE: a Draft IA", go(create({ expected_fp: fpIa(ia({ status: "Draft" }), lines()) }), { ia: ia({ status: "Draft" }) }), "400", /Created/);
quiet("CREATE: the setup off (D12)", go(create(), { setup: OFF }), "400", /turned off/);
quiet("CREATE: no setup row (off)", go(create(), { setup: null }), "400", /turned off/);
quiet("CREATE: nothing reserved", go(create(), { holds: [] }), "400", /Nothing of this Item Assembly is reserved/);
quiet("CREATE: unsaved edits", go(create({ expected_fp: fpIa(ia({ item_qty: 3 }), lines()) })), "409", /unsaved/);
quiet("CREATE: an inactive bin", go(create(), { bin: { active: 0 } }), "400", /active bin/);
quiet("CREATE: a bad date", go(create({ required_date: "2026-02-30" })), "400", /required/);
quiet("CREATE: a live request", go(create(), { reqs: [{ id: "2114000000000000010", no: "LOT-10", status: "Requested", rev: 1, fp: "x", sl: SL, bin: BIN }] }), "200",
  /already has transfer request LOT-10/);
quiet("CREATE: a received request", go(create(), { reqs: [{ id: "2114000000000000010", no: "LOT-10", status: "Completed", rev: 1, fp: "x", sl: SL, bin: BIN }] }), "409", /Replace/);
r = go(create(), { otherClaims: [{ id: "2114200000000009999", name: "CLAIM|0", started_at: "2026-10-30 11:59:50" }] });
eq("CREATE twin: 409, only our claim written, then freed as lost", [r.code, r.writes.map((w) => w[0] + " " + w[1] + " " + (w[2].step_status || ""))],
  ["409", ["insert GD Publish Step HELD", "update GD Publish Step FREE"]]);
eq("CREATE: the IA no longer Created meanwhile -> 409, no request written", [go(create(), { iaNow: "Completed" }).code, of(go(create(), { iaNow: "Completed" }), "Location Transfer").length],
  ["409", 0]);
r = go(create(), { back: { lot: null } });
eq("CREATE: the request not read back -> 500, no IA link, claim freed as unconfirmed", [r.code, of(r, "Item Assembly").length, of(r, "GD Publish Step", "update")[0].result_ref],
  ["500", 0, "UNCONFIRMED|IATR:" + IA + ":k1"]);
const backOk = { id: "1", no: "LOT-1", status: "Requested", fp: fpReq(holds(), BIN), rev: "1", purpose: "IA_SUPPLY", source: IA,
  lines: [{ source_ia_line_id: L1 }, { source_ia_line_id: L2 }] };
const backAs = (o) => go(create(), { back: { lot: Object.assign({}, backOk, o || {}) } }).code;
eq("CREATE: a well-formed read-back -> 200 (the control)", backAs({}), "200");
eq("CREATE: read back with another fingerprint, other lines, another IA's, not Requested, not numbered -> 500",
  [backAs({ fp: "RR1:2:0000000000000000" }), backAs({ lines: backOk.lines.slice(0, 1) }), backAs({ source: "1" }), backAs({ status: "Draft" }), backAs({ no: "issued" })],
  ["500", "500", "500", "500", "500"]);
quiet("CREATE: a non-digit IA id", go(create({ ia_id: "x" })), "400", /ia_id/);

// ================================================================ REFRESH (D4)
const named = (o) => Object.assign({ id: LOTID, no: "LOT-20261030/0001", status: "Requested", purpose: "IA_SUPPLY", source: IA, fp: fpReq(holds(), BIN), rev: 1,
  log: JSON.stringify([{ op: "CREATE" }]), org: ORG, sl: SL, bin: BIN, lines: [], openJobs: 0, openTransit: 0 }, o || {});
const refresh = (o) => Object.assign({ operation: "REFRESH", ia_id: IA, organization_id: ORG, lot_id: LOTID, expected_fp: fpIa(ia(), lines()), idempotency_key: "IATR:" + IA + ":k2" },
  o || {});
const lessHeld = [hold("2115000000000000001", L1, M1, W1, 1), hold("2115000000000000002", L2, M2, W1, 3)];
r = go(refresh(), { named: named(), reqs: [named()], holds: lessHeld });
eq("REFRESH after a hold change: 200; claim, the request, claim freed", [r.code, r.writes.map((w) => w[0] + " " + w[1])],
  ["200", ["insert GD Publish Step", "update Location Transfer", "update GD Publish Step"]]);
const up = of(r, "Location Transfer")[0];
eq("  the request: the reservation's fingerprint, revision 2, the log + REFRESH", [up.source_ia_fp, up.source_ia_rev, JSON.parse(up.request_log).map((e) => e.op)],
  [fpReq(lessHeld, BIN), "2", ["CREATE", "REFRESH"]]);
eq("  its lines and picks from the reservation now", up.stock_movement.map((l) => [l.source_ia_line_id, l.requested_qty, JSON.parse(l.temp_qty_data).length]),
  [[L1, "1.00000000", 1], [L2, "3.00000000", 1]]);
eq("  the reads: lines and the named request, no destination", [/'YES' = 'YES' AND a\.tenant_id/.test(r.sqls.ia),
  /'YES' = 'YES' AND g\.tenant_id = '711077' AND g\.id = 2114100000000000001/.test(r.sqls.req), /'NO' = 'YES' AND s\.tenant_id/.test(r.sqls.dest)], [true, true, true]);
quiet("REFRESH: the reservation unchanged", go(refresh(), { named: named(), reqs: [named()] }), "200", /already matches/);
quiet("REFRESH: a dispatched request", go(refresh(), { named: named({ status: "In Progress" }), reqs: [named({ status: "In Progress" })], holds: lessHeld }), "400", /Only a Requested/);
quiet("REFRESH: being dispatched", go(refresh(), { named: named({ openJobs: 1 }), reqs: [named()], holds: lessHeld }), "409", /being dispatched/);
eq("REFRESH with the setup off still works (D13)", go(refresh(), { named: named(), reqs: [named()], holds: lessHeld, setup: OFF }).code, "200");

// ================================================================ REPLACE (D6)
const received = { id: RECV, no: "LOT-20261030/0002", status: "Completed", rev: 1, fp: "x", sl: SL, bin: BIN, log: "[]" };
const atStg = [hold("2115000000000000007", L1, M1, BIN, 1, { job_line_key: "IATR|" + RECV + "|1" }), hold("2115000000000000008", L2, M2, BIN, 2, { job_line_key: "IATR|" + RECV + "|2" })];
const replace = (o) => Object.assign(create({ operation: "REPLACE", idempotency_key: "IATR:" + IA + ":k4" }), o || {});
r = go(replace(), { reqs: [received], holds: atStg.concat([hold("2115000000000000009", L2, M2, W2, 2)]), max: 3 });
eq("REPLACE after a receipt: 200, the replacement created and linked", [r.code, r.message], ["200", "Replacement request LOT-20261030/0007 created."]);
const rep = of(r, "Location Transfer", "insert")[0];
eq("  linked to the received request; only the new reservation, away from the staging bin", [rep.replacement_for_id, rep.stock_movement.map((l) => [l.source_ia_line_id, l.requested_qty]),
  of(r, "Item Assembly")[0].transfer_request_id], [RECV, [[L2, "2.00000000"]], rep.id]);
eq("  the claim numbering counts every claim of the IA (received requests included)", of(r, "GD Publish Step", "insert")[0].step_name, "CLAIM|4");
quiet("REPLACE before a receipt", go(replace(), { reqs: [] }), "400", /follows a received/);
quiet("REPLACE while one is open", go(replace(), { reqs: [received, { id: "2114100000000000003", no: "LOT-3", status: "Requested", rev: 1, fp: "", sl: SL, bin: BIN }] }), "200",
  /already has/);
quiet("REPLACE with nothing newly reserved", go(replace(), { reqs: [received], holds: atStg }), "400", /Nothing new is reserved/);
quiet("REPLACE to another bin", go(replace({ location_id: "2106278340907413599" }), { reqs: [received], holds: atStg.concat([hold("2115000000000000009", L2, M2, W2, 2)]) }), "400",
  /staging bin/);
eq("REPLACE with the setup off still works (D13)", go(replace(), { reqs: [received], holds: atStg.concat([hold("2115000000000000009", L2, M2, W2, 2)]), setup: OFF }).code, "200");

// ================================================================ DEFECT (D2)
const stgLines = () => lines().map((l) => (l.id === L1 ? Object.assign({}, l, { temp_qty_data: JSON.stringify([pk(M1, BIN, 1, { iatr_lot_id: RECV })]) })
  : l.id === L2 ? Object.assign({}, l, { temp_qty_data: JSON.stringify([pk(M2, BIN, 2, { iatr_lot_id: RECV })]) }) : l));
const defect = (defects, o) => Object.assign({ operation: "DEFECT", ia_id: IA, organization_id: ORG, idempotency_key: "IATR:" + IA + ":k5", defects: JSON.stringify(defects) }, o || {});
const dsc = (o) => Object.assign({ reqs: [received], holds: atStg, lines: stgLines() }, o || {});
r = go(defect({ [L2]: { qty: "0.5", reason: "Damaged" } }), dsc());
eq("DEFECT: 200; claim, the engine, the reservation rows, the IA lines, the received request's log, claim freed", [r.code, r.writes.map((w) => w[0] + " " + w[1]), r.calls.length],
  ["200", ["insert GD Publish Step", "update On Reserved Goods Delivery", "update Stock movement(Item Assembly)", "update Location Transfer", "update GD Publish Step"], 1]);
const call = r.calls[0];
eq("  the engine: APPLY, one operation per click, Reserved -> Blocked at the staging bin (IA-D)", [call.mode, call.operation_key, call.organization_id,
  call.movements.map((m) => [m.movement_key, m.direction, m.inventory_category, m.location_id, m.quantity, m.transaction_type, m.trx_no])],
  ["APPLY", "IAD|" + R.iatrHash("IATR:" + IA + ":k5"), ORG, [["D1", "SUBTRACT", "Reserved", BIN, 0.5, "IA-D", "IA-2610-030/D"], ["D1.2", "ADD", "Blocked", BIN, 0.5, "IA-D", "IA-2610-030/D"]]]);
eq("  the reservation row less the defect", of(r, "On Reserved Goods Delivery").map((h) => [h.__id, h.open_qty, h.reserved_qty, h.status]), [["2115000000000000008", "1.5", "1.5", "Allocated"]]);
eq("  the IA line's picks, total and summary", of(r, "Stock movement(Item Assembly)").map((l) => [l.__id, JSON.parse(l.temp_qty_data)[0].sm_quantity, l.total_quantity, l.stock_summary]),
  [[L2, 1.5, "1.50000000", "Total: 1.5 PCS\n\nDETAILS:\n1. PROD-01: 1.5 PCS (UNR)"]]);
eq("  the received request's log gains the defect", JSON.parse(of(r, "Location Transfer")[0].request_log).map((e) => [e.op, e.by, e.claim]), [["DEFECT", "Production Planner", "CLAIM|1"]]);
r = go(defect({ [L2]: { qty: "0.5", reason: "Damaged" } }), dsc({ engine: { code: "400", result_code: "INSUFFICIENT_STOCK", message: "only 1 Reserved at PROD-01" } }));
eq("DEFECT refused by the engine: 400 with its reason; only our claim, freed", [r.code, /only 1 Reserved/.test(r.message), r.writes.map((w) => w[0] + " " + w[1] + " " + (w[2].step_status || ""))],
  ["400", true, ["insert GD Publish Step HELD", "update GD Publish Step FREE"]]);
eq("  the claim freed is ours", [of(r, "GD Publish Step", "update")[0].__id, of(r, "GD Publish Step", "update")[0].result_ref],
  [of(r, "GD Publish Step", "insert")[0].id, "DEFECT|400|IATR:" + IA + ":k5"]);
eq("DEFECT: the stock locked by another operation -> 409", go(defect({ [L2]: { qty: "0.5", reason: "Damaged" } }), dsc({ engine: { code: "409", message: "busy" } })).code, "409");
eq("DEFECT: no answer from the engine -> 500, nothing more written", [go(defect({ [L2]: { qty: "0.5", reason: "D" } }), dsc({ engine: {} })).code,
  go(defect({ [L2]: { qty: "0.5", reason: "D" } }), dsc({ engine: {} })).writes.length], ["500", 2]);
quiet("DEFECT more than held at the staging bin", go(defect({ [L2]: { qty: "3", reason: "Damaged" } }), dsc()), "400", /only 2 reserved/);
quiet("DEFECT without a reason", go(defect({ [L2]: { qty: "1", reason: "" } }), dsc()), "400", /reason/);
quiet("DEFECT: defects that are not line ids", go(defect({ x: { qty: "1", reason: "R" } }), dsc()), "400", /defects/);
quiet("DEFECT before a receipt", go(defect({ [L2]: { qty: "1", reason: "R" } }), dsc({ reqs: [] })), "400", /after a transfer request is received/);
eq("DEFECT with the setup off still works (D13)", go(defect({ [L2]: { qty: "0.5", reason: "D" } }), dsc({ setup: OFF })).code, "200");
r = go(defect({ [L2]: { qty: "0.5", reason: "D" } }), dsc({ back: { lot: null, holds: atStg, lines: stgLines() } }));
eq("DEFECT: the rows not read back at their targets -> 500, claim freed as unconfirmed", [r.code, of(r, "GD Publish Step", "update")[0].result_ref], ["500", "UNCONFIRMED|IATR:" + IA + ":k5"]);
eq("  the reads: DEFECT parts on", [/'YES' = 'YES' AND u\.id IN/.test(go(defect({ [L2]: { qty: "0.5", reason: "D" } }), dsc()).sqls.ia),
  /IF\('YES' = 'YES', g\.request_log/.test(go(defect({ [L2]: { qty: "0.5", reason: "D" } }), dsc()).sqls.req)], [true, true]);

// ================================================================ CANCEL (state only: the IA keeps its reservation)
const cancel = (o) => Object.assign({ operation: "CANCEL", ia_id: IA, organization_id: ORG, lot_id: LOTID, idempotency_key: "IATR:" + IA + ":k3" }, o || {});
r = go(cancel(), { named: named(), reqs: [named()] });
eq("CANCEL: 200; claim, the request, claim freed (no reservation write)", [r.code, r.writes.map((w) => w[0] + " " + w[1])],
  ["200", ["insert GD Publish Step", "update Location Transfer", "update GD Publish Step"]]);
const cx = of(r, "Location Transfer")[0];
eq("  Cancelled, unlinked from any job, the log + CANCEL; nothing else", [cx.stock_movement_status, cx.lot_v2_job_id, JSON.parse(cx.request_log).map((e) => e.op), Object.keys(cx).sort()],
  ["Cancelled", "", ["CREATE", "CANCEL"], ["__id", "lot_v2_job_id", "request_log", "stock_movement_status"]]);
eq("  the reads: no lines, the named request", [/'NO' = 'YES' AND a\.tenant_id/.test(r.sqls.ia), /'YES' = 'YES' AND g\.tenant_id = '711077' AND g\.id = 2114100000000000001/.test(r.sqls.req)],
  [true, true]);
quiet("CANCEL: no idempotency key", go(cancel({ idempotency_key: "" }), { named: named() }), "400", /idempotency_key/);
quiet("CANCEL: a dispatched request", go(cancel(), { named: named({ status: "In Progress" }), reqs: [named({ status: "In Progress" })] }), "400", /Location Transfer list/);
r = go(cancel(), { ia: null, named: named(), reqs: [named()] });
eq("CANCEL, its IA deleted: still cancelled by its organisation", [r.code, (of(r, "Location Transfer")[0] || {}).stock_movement_status], ["200", "Cancelled"]);
eq("  no IA to relink", of(r, "Item Assembly").length, 0);
// Task 10: the IA's link (its list's Transfer Request column) shows the latest open or received request - a cancelled replacement gives it
// back to the received request
r = go(cancel(), { named: named(), reqs: [named(), received] });
eq("CANCEL of a replacement, a received request before it: the IA relinked to the received one", [r.code, r.writes.map((w) => w[0] + " " + w[1]),
  of(r, "Item Assembly").map((x) => [x.__id, x.transfer_request_id, x.transfer_request_no])],
["200", ["insert GD Publish Step", "update Location Transfer", "update Item Assembly", "update GD Publish Step"], [[IA, RECV, "LOT-20261030/0002"]]]);
r = go(cancel(), { named: named(), reqs: [named(), Object.assign({}, received, { status: "Cancelled" })] });
eq("CANCEL with only cancelled requests besides: the IA's link kept (no write)", of(r, "Item Assembly").length, 0);
// the link write is gated off, never run without its IA (an update node's WHERE is not to be trusted with an empty id)
const doneOut = (rr) => { const o = rr.out.code_node_TRdone || {}; const d = o.data || o; return [d.needLink, d.link && d.link.id]; };
eq("  Done: needLink NO, no link row", doneOut(r), ["NO", "0"]);
eq("  (relinking: needLink YES with the IA's id)", doneOut(go(cancel(), { named: named(), reqs: [named(), received] })), ["YES", IA]);

// ================================================================ STATUS
r = go({ operation: "STATUS", ia_id: IA, organization_id: ORG }, { reqs: [named()] });
quiet("STATUS", r, "200", /^$/);
eq("  the request, not stale; the setup on, no new request", [r.result.request.no, r.result.request.stale, r.result.setup_on, r.result.can_create], ["LOT-20261030/0001", "NO", "YES", "NO"]);
eq("STATUS: the reservation changed -> stale (refresh)", go({ operation: "STATUS", ia_id: IA, organization_id: ORG }, { reqs: [named()], holds: lessHeld }).result.request.stale, "YES");
r = go({ operation: "STATUS", ia_id: IA, organization_id: ORG }, { reqs: [received], holds: atStg });
eq("STATUS after a receipt: may replace; the gap (Bolt M8 lacks 2); the staging bin", [r.result.can_replace, r.result.gap, r.result.staging], ["YES", [{ iaLineId: L2, missing: "2" }],
  { sl: SL, bin: BIN }]);
eq("STATUS with the setup off and no request: may not create", [go({ operation: "STATUS", ia_id: IA, organization_id: ORG }, { setup: OFF }).result.can_create], ["NO"]);

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
