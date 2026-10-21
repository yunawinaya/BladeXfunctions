// node scratchpad/iasc/res01/test/sim_hold.js [IA_HOLD.json] - the BUILT IA_HOLD end to end in the iav2 interpreter, over a small
// world (the IA, its lines, its own hold rows, its tickets, the balances, the engine's record of each operation) with an
// all-or-nothing engine stub for INVENTORY_BULK_APPLY (replays a done operation)
const path = require("path");
const fs = require("fs");
const { Engine } = require(path.join(__dirname, "..", "..", "..", "iav2", "lib", "sim", "engine.js"));

const BUILT = process.argv[2] || process.env.HD_BUILT || path.join(__dirname, "..", "..", "..", "..", "Item Assembly & BOM", "SmallCycle", "IA_HOLD.json");
const T = "000000";
const UID = "2109866916722085890";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const IA = "2112800000000000001";
// ids as long as the real ones: JSON.parse / Number round 19-digit ids, so they show any id handled as a number
const EA = "77";
const CTN = "78";
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 900) + "\n  want " + JSON.stringify(want).slice(0, 900));
  }
};

const ITEMS = [
  { id: "2105488759446736918", stock_control: 1, serial_number_management: 0, based_uom: EA, material_costing_method: "First In First Out",
    table_uom_conversion: [{ alt_uom_id: CTN, base_qty: "12", alt_qty: "1" }] },
  { id: "2105488759446736919", stock_control: 1, serial_number_management: 0, based_uom: EA, material_costing_method: "First In First Out", table_uom_conversion: [] },
  { id: "2105488759446736921", stock_control: 1, serial_number_management: 1, based_uom: EA, material_costing_method: "First In First Out", table_uom_conversion: [] },
];
const B1 = "2106278340907413505";
const B2 = "2106278340907413507";
const pick = (bin, qty, extra) => Object.assign({ location_id: bin, batch_id: null, sm_quantity: qty, category: "Unrestricted" }, extra || {});
const line = (id, item, picks, extra) => Object.assign({ id: id, item_selection: item, item_name: "I" + item, quantity_uom: EA, total_quantity: String(picks.reduce((s, p) => s + p.sm_quantity, 0)),
  required_qty: null, requested_qty: "0", temp_qty_data: JSON.stringify(picks.map((p) => Object.assign({ material_id: item }, p))), temp_hu_data: "", is_deleted: 0 }, extra || {});

class World {
  constructor(o) {
    o = o || {};
    this.ia = Object.assign({ id: IA, no: "IA-0001", status: "Draft", organization_id: ORG, plant_id: PLANT, hold: "RESERVING", hold_at: null, is_deleted: 0,
      ut: "2026-10-21 11:59:00.000000" }, o.ia || {});
    this.lines = o.lines || [line("3001", "2105488759446736918", [pick(B1, 6)])];
    this.items = o.items || ITEMS;
    this.rows = (o.rows || []).map((r) => Object.assign({ doc_type: "Item Assembly", doc_id: IA, is_deleted: 0, item_uom: EA, from_category: "Unrestricted", job_line_key: "", batch_id: null }, r));
    this.tickets = o.tickets || [];
    this.bal = o.bal || { ["2105488759446736918|" + B1 + "|"]: { Unrestricted: 10, Reserved: 0, Blocked: 0 } };
    this.ops = o.ops || {};
    this.now = o.now || "2026-10-21 12:00:00";
    this.member = o.member === undefined ? 1 : o.member;
    this.uid = o.uid === undefined ? UID : o.uid;
    this.dup = o.dup || {};
    this.cost = o.cost || {};
    this.engine = o.engine || null;
    this.afterBal = o.afterBal || null;
    // inventory_movement rows of this IA: { id, trx_no, transaction_type, movement, inventory_category, item_id, bin, batch, base_qty, org }
    this.moves = o.moves || [];
    this.seq = 3000000000000000000n;
    this.calls = [];
    this.sqls = {};
  }
  id() {
    this.seq += 1n;
    return this.seq.toString();
  }
  live() {
    return this.rows.filter((r) => !r.is_deleted && ["Allocated", "Processing", "Releasing"].indexOf(r.status) >= 0);
  }
}
const J = (o) => ({ j: JSON.stringify(o) });
const has = (w, node, sql, frag) => {
  const s = sql.replace(/\s+/g, " ");
  if (s.indexOf(frag) < 0) throw new Error(node + " SQL is missing " + frag + ":\n" + s);
};
const jsonIn = (sql, re) => JSON.parse((re.exec(sql.replace(/\s+/g, " ")) || [])[1] || "[]");
class Sim extends Engine {
  constructor(w) {
    const db = {
      tenantId: T, uid: w.uid,
      insert: (table, rows) => rows.map((r0) => {
        const r = Object.assign({}, r0, { id: w.id() });
        if (table === "GD Publish Step") w.tickets.push(r);
        else if (table === "On Reserved Goods Delivery") w.rows.push(Object.assign({ is_deleted: 0 }, r));
        else throw new Error("insert into " + table);
        return r;
      }),
      update: (table, rows) => {
        rows.forEach((r) => {
          const id = String(r.__id);
          const target = table === "GD Publish Step" ? w.tickets.find((x) => String(x.id) === id) : table === "On Reserved Goods Delivery" ? w.rows.find((x) => String(x.id) === id)
            : table === "Item Assembly" && id === w.ia.id ? w.ia : null;
          if (!target) throw new Error("update of " + table + " " + id + ": no such row");
          Object.keys(r).forEach((k) => {
            if (k === "__id" || k === "id") return;
            if (table === "Item Assembly") target[k === "material_hold_status" ? "hold" : k === "material_hold_at" ? "hold_at" : k] = r[k];
            else target[k] = r[k];
          });
          if (table === "Item Assembly") target.ut = "2026-10-21 12:00:09.000000";
        });
        return { count: rows.length };
      },
    };
    const sql = {
      sql_node_HDstate: (q) => {
        w.sqls.state = q;
        // the clock: UTC+8 as the app writes every datetime; NOW() is the session's (UTC on prod; review M7)
        if (/\bNOW\(\)/.test(q) || q.indexOf("DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s')") < 0) throw new Error("state: the clock is not UTC+8:\n" + q);
        has(w, "state", q, "h.tenant_id = '" + T + "' AND h.id = " + w.ia.id);
        has(w, "state", q, "r.doc_type = 'Item Assembly' AND r.doc_id = '" + w.ia.id + "'");
        // the rows read for the request's organisation (every row of this world is ORG's)
        const rowOrg = (/r\.organization_id = '([0-9]+)'/.exec(q.replace(/\s+/g, " ")) || [])[1];
        if (!rowOrg) throw new Error("state SQL reads the rows without an organisation");
        has(w, "state", q, "p.job_id = 'IAH|" + w.ia.id + "'");
        const tickets = w.tickets.filter((t) => t.job_id === "IAH|" + w.ia.id && /^TICKET\|/.test(t.step_name));
        return [J({ now: w.now, ia: w.ia, lines: w.lines, rows: rowOrg === ORG ? w.live() : [], ticket_max: tickets.reduce((m, t) => Math.max(m, Number(t.step_name.slice(7))), 0),
          held: tickets.filter((t) => t.step_status === "HELD").map((t) => ({ id: t.id, n: Number(t.step_name.slice(7)), started_at: t.started_at, op: t.result_ref })) })];
      },
      sql_node_HDhead: (q) => {
        w.sqls.head = q;
        has(w, "head", q, "h.tenant_id = '" + T + "' AND h.id = " + w.ia.id);
        return [J({ hold: w.ia.hold, ut: w.ia.ut })];
      },
      sql_node_HDitems: (q) => {
        has(w, "items", q, "l.sm_item_assembly_id = " + w.ia.id);
        return w.items.filter((i) => w.lines.some((l) => l.item_selection === i.id)).map(J);
      },
      sql_node_HDmember: (q) => {
        w.sqls.member = q;
        has(w, "member", q, "u.id = " + UID + " LIMIT 1");
        // the organisation asked about (the request's, which the plan compares with the IA's)
        w.memberOrg = (/\(p\.id = (\d+) OR FIND_IN_SET\('\d+', p\.ancestors\) > 0\)/.exec(q.replace(/\s+/g, " ")) || [])[1] || "";
        return [J({ member: w.member })];
      },
      sql_node_HDops: (q) => jsonIn(q, /JSON_TABLE\('(\[[^']*\])'/).filter((op) => w.ops[op]).map((op) => J(Object.assign({ op: op }, w.ops[op]))),
      sql_node_HDops2: (q) => jsonIn(q, /JSON_TABLE\('(\[[^']*\])'/).filter((op) => w.ops[op]).map((op) => J(Object.assign({ op: op }, w.ops[op]))),
      sql_node_HDbal: (q) => {
        w.sqls.bal = q;
        has(w, "bal", q, "x.plant_id = " + PLANT + " AND x.organization_id = '" + ORG + "'");
        has(w, "bal", q, "wc.plant_id = '" + PLANT + "'");
        // the keys read exactly as text (a JSON.parse would round the ids the way the bug did)
        const keys = [...q.replace(/\s+/g, " ").matchAll(/\[(\d+),(\d+),(\d+)\]/g)].map((x) => [x[1], x[2], x[3]]);
        if (w.afterBal) w.afterBal(w);
        return keys.map(([m, l, b]) => {
          const k = [m, l, b !== "0" ? b : ""].join("|");
          const v = w.bal[k] || { Unrestricted: 0, Reserved: 0, Blocked: 0 };
          const item = w.items.find((i) => i.id === String(m)) || {};
          return J({ material_id: m, location_id: l, batch_id: b !== "0" ? b : null, unrestricted_qty: String(v.snapshotU === undefined ? v.Unrestricted : v.snapshotU),
            block_qty: String(v.Blocked), item_rows: w.dup[k] ? 2 : 1, batch_rows: b ? 1 : 0, method: item.material_costing_method, fifo: w.cost[k] ? 1 : 0, wa: w.cost[k] ? 1 : 0 });
        });
      },
      sql_node_HDconsumed: (q) => {
        w.sqls.consumed = q;
        const s = q.replace(/\s+/g, " ");
        has(w, "consumed", q, "m.trx_no = '" + w.ia.no + "'");
        has(w, "consumed", q, "m.organization_id = '" + ORG + "'");
        has(w, "consumed", q, "r.id > " + w.ia.id + " AND r.trx_no = '" + w.ia.no + "' AND r.transaction_type = 'IA-R'");
        has(w, "consumed", q, "d.doc_id = '" + w.ia.id + "' AND d.status = 'Delivered' AND d.doc_no = '" + w.ia.no + "'");
        has(w, "consumed", q, "d.organization_id = '" + ORG + "'");
        if (!/m\.transaction_type = 'IA' AND m\.movement = 'OUT' AND m\.inventory_category = 'Reserved'/.test(s)) throw new Error("consumed: not the IA's Reserved issues:\n" + s);
        // the cycle: after the IA was created and after its last revert ('IA-R') under this number
        const big = (x) => BigInt(String(x));
        const lo = w.moves.filter((m) => m.trx_no === w.ia.no && m.transaction_type === "IA-R" && big(m.id) > big(w.ia.id)).reduce((a, m) => (big(m.id) > a ? big(m.id) : a), big(w.ia.id));
        const out = {};
        w.moves.filter((m) => big(m.id) > lo && m.trx_no === w.ia.no && m.org === ORG && m.transaction_type === "IA" && m.movement === "OUT" && m.inventory_category === "Reserved")
          .forEach((m) => {
            const k = [m.item_id, m.bin, m.batch || ""].join("|");
            out[k] = q8((out[k] || 0) + Number(m.base_qty));
          });
        const delivered = w.rows.filter((r) => !r.is_deleted && r.status === "Delivered" && r.doc_no === w.ia.no && big(r.id) > lo)
          .map((r) => J({ kind: "DELIVERED", id: r.id, material_id: r.material_id, bin_location: r.bin_location, batch_id: r.batch_id, item_uom: r.item_uom, delivered_qty: String(r.delivered_qty) }));
        return Object.keys(out).map((k) => J({ kind: "OUT", key: k, base: String(out[k]) })).concat(delivered);
      },
      sql_node_HDtickets: (q) => {
        has(w, "tickets", q, "p.job_id = 'IAH|" + w.ia.id + "'");
        return w.tickets.filter((t) => t.step_status === "HELD").map((t) => J({ id: t.id, n: Number(t.step_name.slice(7)), started_at: t.started_at, op: t.result_ref }));
      },
    };
    super({ dir: path.dirname(BUILT), db: db, mocks: { sql: sql, read: {} } });
    this.w = w;
  }
  load(name) {
    if (name === "IA_HOLD") return JSON.parse(fs.readFileSync(BUILT, "utf8"));
    throw new Error("no workflow " + name);
  }
  run(name, params) {
    if (name !== "INVENTORY_BULK_APPLY") return super.run(name, params);
    const w = this.w;
    w.calls.push(JSON.parse(JSON.stringify(params)));
    if (w.engine) {
      const a = w.engine(params, w);
      if (a) return { returned: a };
    }
    const op = params.operation_key;
    if (w.ops[op] && w.ops[op].done) return { returned: { code: "200", result_code: "OK_REPLAYED", message: "replayed" } };
    const bal = JSON.parse(JSON.stringify(w.bal));
    for (const m of params.movements) {
      const item = w.items.find((i) => i.id === m.material_id) || {};
      const conv = m.material_uom && m.material_uom !== item.based_uom ? (item.table_uom_conversion || []).find((c) => c.alt_uom_id === m.material_uom) : null;
      const base = q8(m.quantity * (conv ? Number(conv.base_qty) : 1));
      const k = [m.material_id, m.location_id, m.batch_id || ""].join("|");
      const b = bal[k] || (bal[k] = { Unrestricted: 0, Reserved: 0, Blocked: 0 });
      delete b.snapshotU;
      if (m.direction === "SUBTRACT") {
        if ((b[m.inventory_category] || 0) < base - 1e-9) return { returned: { code: "400", result_code: "INSUFFICIENT", message: "Insufficient " + m.inventory_category + " at " + k } };
        b[m.inventory_category] = q8(b[m.inventory_category] - base);
      } else b[m.inventory_category] = q8((b[m.inventory_category] || 0) + base);
    }
    w.bal = bal;
    w.ops[op] = { done: 1, intents: params.movements.length };
    return { returned: { code: "200", result_code: "OK", message: "ok", summary: { movements: params.movements.length } } };
  }
}
const hold = (w, params) => {
  const r = new Sim(w).run("IA_HOLD", Object.assign({ ia_id: IA, organization_id: ORG, operation: "RECONCILE", source: "SAVE" }, params || {})).returned;
  return Object.assign({}, r, { result: r.result_json ? JSON.parse(r.result_json) : null });
};
const allocated = (w) => w.live().filter((r) => r.status === "Allocated").map((r) => [r.doc_line_id, r.material_id, r.bin_location, r.from_category, q8(r.open_qty)]);
const k1 = "2105488759446736918|" + B1 + "|";

// ---- refusals and no-ops
{
  let w = new World({ ia: { hold: "" } });
  let r = hold(w);
  eq("not enrolled: 200 'Not enrolled', nothing written, no move", [r.code, /Not enrolled/.test(r.message), w.rows.length, w.tickets.length, w.calls.length], ["200", true, 0, 0, 0]);
  w = new World({ member: 0 });
  r = hold(w);
  eq("a user not assigned to the organisation: 400, nothing moved (FIX-03)", [r.code, /not assigned to this organisation/.test(r.message), w.calls.length], ["400", true, 0]);
  w = new World();
  r = hold(w, { organization_id: "999" });
  eq("another organisation's IA: 400", [r.code, /another organisation/.test(r.message), w.calls.length], ["400", true, 0]);
  w = new World({ ia: { status: "Processing" } });
  r = hold(w);
  eq("a background completion holds the IA: 409, nothing moved", [r.code, w.calls.length], ["409", 0]);
  w = new World({ ia: { status: "Completed" } });
  r = hold(w);
  eq("a completed IA: 200 nothing to reserve", [r.code, /Nothing to reserve/.test(r.message), w.calls.length], ["200", true, 0]);
  w = new World({ uid: "" });
  r = hold(w);
  eq("no session user: 400, nothing read or moved", [r.code, /session user/.test(r.message), w.calls.length], ["400", true, 0]);
  r = new Sim(new World()).run("IA_HOLD", { ia_id: IA, organization_id: ORG, operation: "BOOK", source: "SAVE" }).returned;
  eq("an unknown operation: 400", [r.code, /operation/.test(r.message)], ["400", true]);
}
// ---- first save: hold what is picked
let w = new World();
let r = hold(w);
eq("first save: 6 held (one engine operation IAH|<ia>|1: Unrestricted -> Reserved)", [r.code, w.calls.length, w.calls[0] && w.calls[0].operation_key,
  w.calls[0] && w.calls[0].movements.map((m) => [m.movement_key, m.direction, m.inventory_category, m.quantity, m.isMovingInv, m.transaction_type])],
  ["200", 1, "IAH|" + IA + "|1", [["H1", "SUBTRACT", "Unrestricted", 6, 1, "IA-H"], ["H1.2", "ADD", "Reserved", 6, 1, "IA-H"]]]);
eq("first save: one Allocated row for the line (no Processing left), the stock in Reserved", [allocated(w), w.live().filter((x) => x.status !== "Allocated").length, w.bal[k1]],
  [[["3001", "2105488759446736918", B1, "Unrestricted", 6]], 0, { Unrestricted: 4, Reserved: 6, Blocked: 0 }]);
eq("first save: the header FULL, checked now; the ticket FREE", [w.ia.hold, w.ia.hold_at, w.tickets.map((t) => [t.step_name, t.step_status])],
  ["FULL", "2026-10-21 12:00:00", [["TICKET|1", "FREE"]]]);
eq("first save: the result per line", r.result.lines.map((x) => [x.lineId, x.required, x.reserved, x.short]), [["3001", 6, 6, 0]]);
// review I1: a save while this reconcile works (its lines read before) marks the IA RESERVING again: that mark stays, so the next open
// reserves the saved lines; this run's holds stand
{
  const ws = new World({ afterBal: (x) => Object.assign(x.ia, { hold: "RESERVING", ut: "2026-10-21 12:00:05.200000" }) });
  const rs = hold(ws);
  eq("a save during the reconcile: its 6 held, the header left RESERVING (not FULL), the answer says so", [allocated(ws).length, ws.ia.hold, rs.result.status,
    /Saved again while reserving/.test(rs.message), !!ws.sqls.head], [1, "RESERVING", "RESERVING", true, true]);
}
eq("first save: the membership read for the session user and the IA's organisation", w.memberOrg, ORG);
// ---- the same save again: nothing to move
r = hold(w);
eq("unchanged re-save: no move, no ticket, still FULL", [r.code, w.calls.length, w.tickets.length, w.ia.hold], ["200", 1, 1, "FULL"]);
// ---- more picked
w.lines = [line("3001", "2105488759446736918", [pick(B1, 9)])];
r = hold(w);
eq("pick raised to 9: only the 3 more held (rows 6 + 3), 1 free left", [w.calls.length, w.calls[1].movements.map((m) => [m.direction, m.quantity]), allocated(w), w.bal[k1].Unrestricted],
  [2, [["SUBTRACT", 3], ["ADD", 3]], [["3001", "2105488759446736918", B1, "Unrestricted", 6], ["3001", "2105488759446736918", B1, "Unrestricted", 3]], 1]);
// ---- less picked
w.lines = [line("3001", "2105488759446736918", [pick(B1, 4)])];
r = hold(w);
eq("pick lowered to 4: the two rows released (Cancelled), one row of 4 kept, releases moved before holds", [w.calls[2].movements.map((m) => [m.movement_key, m.direction, m.inventory_category, m.quantity]),
  allocated(w), w.rows.filter((x) => x.status === "Cancelled").map((x) => [q8(x.reserved_qty), q8(x.open_qty)]), w.bal[k1]],
  [[["X1", "SUBTRACT", "Reserved", 5], ["X1.2", "ADD", "Unrestricted", 5]], [["3001", "2105488759446736918", B1, "Unrestricted", 4]], [[6, 0], [3, 0]], { Unrestricted: 6, Reserved: 4, Blocked: 0 }]);
eq("the kept row points at the first released one", w.live().filter((x) => x.status === "Allocated")[0].source_reserved_id, w.rows.find((x) => x.status === "Cancelled").id);
// ---- short of stock: hold what is free, the rest short; never a negative balance
{
  const ws = new World({ lines: [line("3001", "2105488759446736918", [pick(B1, 12)], { required_qty: "12" })], bal: { [k1]: { Unrestricted: 7, Reserved: 0, Blocked: 0 } } });
  r = hold(ws);
  eq("12 wanted, 7 free: 7 held, 5 short, PARTIAL", [allocated(ws), r.result.lines.map((x) => [x.required, x.reserved, x.short]), ws.ia.hold, ws.bal[k1].Unrestricted],
    [[["3001", "2105488759446736918", B1, "Unrestricted", 7]], [[12, 7, 5]], "PARTIAL", 0]);
  const wz = new World({ bal: { [k1]: { Unrestricted: 0, Reserved: 0, Blocked: 0 } } });
  r = hold(wz);
  eq("nothing free: no move, SHORT", [wz.calls.length, wz.ia.hold, r.result.short.map((x) => x.short)], [0, "SHORT", [6]]);
}
// ---- a carton line: the free stock converted (30 EA = 2.5 CTN)
{
  const wc = new World({ lines: [line("3001", "2105488759446736918", [pick(B1, 3)], { quantity_uom: CTN })], bal: { [k1]: { Unrestricted: 30, Reserved: 0, Blocked: 0 } } });
  r = hold(wc);
  eq("3 CTN wanted, 30 EA free: 2.5 CTN held (30 EA moved)", [wc.calls[0].movements.map((m) => [m.quantity, m.material_uom]), allocated(wc), wc.bal[k1]],
    [[[2.5, CTN], [2.5, CTN]], [["3001", "2105488759446736918", B1, "Unrestricted", 2.5]], { Unrestricted: 0, Reserved: 30, Blocked: 0 }]);
}
// ---- what is not held: serial, a handling-unit pick, a duplicate balance row, costing rows to migrate
{
  const k2 = "2105488759446736919|" + B2 + "|";
  const wn = new World({ lines: [line("3001", "2105488759446736921", [pick(B1, 1)]), line("3002", "2105488759446736919", [pick(B1, 2, { handling_unit_id: "7" })]), line("3003", "2105488759446736918", [pick(B1, 1)]),
    line("3004", "2105488759446736919", [pick(B2, 2)])], bal: { [k1]: { Unrestricted: 5, Reserved: 0, Blocked: 0 }, [k2]: { Unrestricted: 5, Reserved: 0, Blocked: 0 } }, dup: { [k1]: 1 }, cost: { [k2]: 1 } });
  r = hold(wn);
  eq("not held: serial, handling unit, a duplicate balance row, costing rows to migrate; nothing moved", [r.result.notHeld.map((x) => [x.lineId, x.reason]), wn.calls.length],
    [[["3001", "SERIAL"], ["3002", "HANDLING_UNIT"], ["3003", "DUPLICATE_BALANCE"], ["3004", "COSTING"]], 0]);
}
// ---- a malformed item id or bin never reaches the SQL text (security review 10-21)
{
  const wj = new World({ lines: [line("3001", "2105488759446736918", [pick(B1, 2)]), line("3002", "1) OR 1=1 --", [pick(B1, 2)]), line("3003", "2105488759446736918", [pick("2001' OR '1", 1)])] });
  r = hold(wj);
  const q = wj.sqls.bal.replace(/\s+/g, " ");
  eq("the balance read names digits only (the malformed item not held, the malformed bin dropped from the keys)", [/OR 1=1/.test(q), /material_id IN \(2105488759446736918\)/.test(q),
    r.result.notHeld.map((x) => [x.lineId, x.reason])], [false, true, [["3002", "ITEM"], ["3003", "PICK"]]]);
  const wo = new World({ rows: [{ id: "81", status: "Processing", doc_line_id: "3001", material_id: "2105488759446736918", bin_location: B1, open_qty: "1", reserved_qty: "1",
    job_line_key: "X') OR ('1|1" }] });
  const sq = [];
  const sim = new Sim(wo);
  const opsMock = sim.mocks.sql.sql_node_HDops;
  sim.mocks.sql.sql_node_HDops = (text) => (sq.push(text), opsMock(text));
  sim.run("IA_HOLD", { ia_id: IA, organization_id: ORG, operation: "RECONCILE", source: "SAVE" });
  eq("an operation key that is not IAH|<digits>|<digits> is never looked up", sq.some((x) => /OR \('1/.test(x)), false);
}
// ---- the mutex
{
  const wl = new World({ tickets: [{ id: "9", job_id: "IAH|" + IA, step_name: "TICKET|4", step_status: "HELD", started_at: "2026-10-21 11:58:00", result_ref: "IAH|" + IA + "|4" }] });
  r = hold(wl);
  eq("another live run (a HELD ticket 2 min old): 409 BUSY, nothing written", [r.code, wl.calls.length, wl.tickets.length], ["409", 0, 1]);
  const we = new World({ tickets: [{ id: "9", job_id: "IAH|" + IA, step_name: "TICKET|4", step_status: "HELD", started_at: "2026-10-21 11:40:00", result_ref: "IAH|" + IA + "|4" }] });
  r = hold(we);
  eq("a dead run's ticket (20 min old): ignored, our ticket TICKET|5 runs", [r.code, we.calls.map((c) => c.operation_key), we.tickets.map((t) => [t.step_name, t.step_status])],
    ["200", ["IAH|" + IA + "|5"], [["TICKET|4", "HELD"], ["TICKET|5", "FREE"]]]);
  // a twin wrote TICKET|1 just before us (its read of the tickets came after ours): the lowest live ticket wins
  const wt = new World();
  wt.afterBal = (x) => x.tickets.push({ id: "8", job_id: "IAH|" + IA, step_name: "TICKET|0", step_status: "HELD", started_at: "2026-10-21 12:00:00", result_ref: "IAH|" + IA + "|0" });
  r = hold(wt);
  eq("a twin with a lower live ticket: ours FREE, 409, no row, no move", [r.code, wt.calls.length, wt.rows.length, wt.tickets.find((t) => t.step_name === "TICKET|1").step_status],
    ["409", 0, 0, "FREE"]);
}
// ---- recovery of a dead run's rows
{
  const opKey = "IAH|" + IA + "|3";
  const left = [{ id: "51", status: "Processing", doc_line_id: "3001", material_id: "2105488759446736918", bin_location: B1, open_qty: "6", reserved_qty: "6", job_line_key: opKey + "|1" }];
  const wd = new World({ rows: left, ops: { [opKey]: { done: 1, intents: 2 } }, tickets: [{ id: "9", job_id: "IAH|" + IA, step_name: "TICKET|3", step_status: "HELD",
    started_at: "2026-10-21 11:30:00", result_ref: opKey }], bal: { [k1]: { Unrestricted: 4, Reserved: 6, Blocked: 0 } } });
  r = hold(wd);
  eq("a dead run that DID move: its Processing row published, nothing more to move, FULL", [allocated(wd), wd.calls.length, wd.ia.hold], [[["3001", "2105488759446736918", B1, "Unrestricted", 6]], 0, "FULL"]);
  const wn = new World({ rows: left.map((x) => Object.assign({}, x)), ops: {} });
  r = hold(wn);
  eq("a dead run that moved nothing: its row dropped, then this run holds 6", [wn.rows.find((x) => x.id === "51").is_deleted, allocated(wn), wn.calls.length], [1, [["3001", "2105488759446736918", B1, "Unrestricted", 6]], 1]);
  const wu = new World({ rows: left.map((x) => Object.assign({}, x)), ops: { [opKey]: { done: 0, intents: 2 } } });
  r = hold(wu);
  eq("a dead run with intents but no DONE: Needs review, no new move, its row left", [wu.ia.hold, wu.calls.length, wu.rows.find((x) => x.id === "51").status, /Needs review/.test(r.message)],
    ["REVIEW", 0, "Processing", true]);
  const rel = [{ id: "52", status: "Releasing", doc_line_id: "3001", material_id: "2105488759446736918", bin_location: B1, open_qty: "6", reserved_qty: "6", job_line_key: opKey + "|52" }];
  const wr = new World({ rows: rel, ops: {}, bal: { [k1]: { Unrestricted: 4, Reserved: 6, Blocked: 0 } } });
  r = hold(wr);
  eq("a dead release that moved nothing: the row back to Allocated (still held), nothing to move", [allocated(wr), wr.calls.length, wr.ia.hold], [[["3001", "2105488759446736918", B1, "Unrestricted", 6]], 0, "FULL"]);
}
// ---- the engine refuses or does not answer
{
  const wi = new World();
  wi.afterBal = (x) => (x.bal[k1] = { Unrestricted: 2, Reserved: 0, Blocked: 0, snapshotU: 10 });
  r = hold(wi);
  eq("the stock went between the read and the move (INSUFFICIENT): nothing moved, rows dropped, Needs review", [wi.ia.hold, allocated(wi), wi.rows.every((x) => x.is_deleted === 1),
    wi.tickets[0].step_status, /stock changed while reserving/.test(r.message)], ["REVIEW", [], true, "FREE", true]);
  const wb = new World({ engine: () => ({ code: "409", result_code: "LOCK_BUSY", message: "keys locked" }) });
  r = hold(wb);
  eq("409 (another operation holds the keys) and no intent: nothing moved, rows dropped, Needs review says busy", [wb.ia.hold, wb.rows.every((x) => x.is_deleted === 1),
    /busy with another operation/.test(r.message)], ["REVIEW", true, true]);
  const wx = new World({ engine: () => ({ code: "", result_code: "", message: "" }) });
  r = hold(wx);
  eq("no answer and no engine record: nothing moved, rows dropped, Needs review", [wx.ia.hold, wx.rows.every((x) => x.is_deleted === 1)], ["REVIEW", true]);
  const wy = new World({ engine: (p, x) => {
    x.ops[p.operation_key] = { done: 0, intents: 2 };
    return { code: "400", result_code: "", message: "child run died" };
  } });
  r = hold(wy);
  eq("a dead child with intents: rows left Processing, Needs review", [wy.ia.hold, wy.rows.map((x) => x.status)], ["REVIEW", ["Processing"]]);
  const wz = new World({ engine: (p, x) => {
    x.ops[p.operation_key] = { done: 1, intents: 2 };
    x.bal[k1] = { Unrestricted: 4, Reserved: 6, Blocked: 0 };
    return { code: "", result_code: "", message: "" };
  } });
  r = hold(wz);
  eq("no answer but the engine recorded DONE: published, FULL", [wz.ia.hold, allocated(wz)], ["FULL", [["3001", "2105488759446736918", B1, "Unrestricted", 6]]]);
}
// ---- stock moved between two lines of the IA with nothing else free: released first, then held (one operation)
{
  const wm = new World({ lines: [line("3001", "2105488759446736918", [pick(B1, 1)]), line("3002", "2105488759446736918", [pick(B1, 5)])],
    rows: [{ id: "71", status: "Allocated", doc_line_id: "3001", material_id: "2105488759446736918", bin_location: B1, open_qty: "6", reserved_qty: "6" }],
    bal: { [k1]: { Unrestricted: 0, Reserved: 6, Blocked: 0 } } });
  r = hold(wm);
  eq("line 3001 gives up 5 that line 3002 takes: release then hold in one operation, both FULL", [wm.calls.length, wm.calls[0].movements.map((m) => [m.direction, m.inventory_category, m.quantity]),
    allocated(wm).sort(), wm.bal[k1], wm.ia.hold], [1, [["SUBTRACT", "Reserved", 5], ["ADD", "Unrestricted", 5], ["SUBTRACT", "Unrestricted", 5], ["ADD", "Reserved", 5]],
    [["3001", "2105488759446736918", B1, "Unrestricted", 1], ["3002", "2105488759446736918", B1, "Unrestricted", 5]], { Unrestricted: 0, Reserved: 6, Blocked: 0 }, "FULL"]);
}
// ---- RELEASE_ALL (a Draft deleted)
{
  const wa = new World({ rows: [{ id: "61", status: "Allocated", doc_line_id: "3001", material_id: "2105488759446736918", bin_location: B1, open_qty: "6", reserved_qty: "6" }],
    bal: { [k1]: { Unrestricted: 4, Reserved: 6, Blocked: 0 } } });
  r = hold(wa, { operation: "RELEASE_ALL", source: "LIST" });
  eq("RELEASE_ALL: every own row Cancelled, the stock back to Unrestricted, nothing kept", [r.code, wa.rows.map((x) => [x.id, x.status]), wa.bal[k1], wa.calls[0].movements.length],
    ["200", [["61", "Cancelled"]], { Unrestricted: 10, Reserved: 0, Blocked: 0 }, 2]);
  // live run 10-21 12:20 said "Nothing could be reserved" (SHORT) after releasing everything
  eq("RELEASE_ALL: says the holds are released, label NONE", [r.message, wa.ia.hold, r.result.status], ["Released: this Item Assembly holds no material now.", "NONE", "NONE"]);
}
// ---- CLOSE (after completion): what the completion issued from Reserved delivers the own holds, the rest is released
{
  const I1 = "2105488759446736918";
  const I2 = "2105488759446736919";
  const NO = "IA-2610-009";
  const id = (k) => "21128000000000001" + k;
  const mv = (k, item, bin, base, extra) => Object.assign({ id: "21128000000000005" + k, trx_no: NO, transaction_type: "IA", movement: "OUT", inventory_category: "Reserved", item_id: item,
    bin: bin, batch: null, base_qty: base, org: ORG }, extra || {});
  const own = (k, lineId, item, bin, qty, extra) => Object.assign({ id: id(k), status: "Allocated", doc_no: "DRAFT-IA-2610-001", doc_line_id: lineId, material_id: item, bin_location: bin,
    open_qty: String(qty), reserved_qty: String(qty), delivered_qty: "0" }, extra || {});
  const kA = I1 + "|" + B1 + "|";
  const kB = I2 + "|" + B1 + "|";
  const kC = I1 + "|" + B2 + "|";
  const completed = (o) => new World(Object.assign({ ia: { status: "Completed", no: NO, hold: "FULL" },
    lines: [line("3001", I1, [pick(B1, 6)]), line("3002", I2, [pick(B1, 5)]), line("3003", I1, [pick(B2, 4)])],
    rows: [own("01", "3001", I1, B1, 6), own("02", "3002", I2, B1, 5), own("03", "3003", I1, B2, 4)],
    // the completion issued 6 of line 3001's hold and 1 of line 3003's; line 3002's 5 were not used
    moves: [mv("01", I1, B1, "6"), mv("02", I1, B2, "1")],
    bal: { [kA]: { Unrestricted: 4, Reserved: 0, Blocked: 0 }, [kB]: { Unrestricted: 0, Reserved: 5, Blocked: 0 }, [kC]: { Unrestricted: 0, Reserved: 3, Blocked: 0 } } }, o || {}));
  const close = (w) => hold(w, { operation: "CLOSE", source: "COMPLETE" });
  const rowsOf = (w) => w.rows.filter((r) => !r.is_deleted).map((r) => [r.id === id("01") ? "R1" : r.id === id("02") ? "R2" : r.id === id("03") ? "R3" : "new", r.status, q8(r.reserved_qty),
    q8(r.open_qty), q8(r.delivered_qty)]);
  let wc = completed();
  r = close(wc);
  eq("CLOSE: one release operation (line 3002's 5 and line 3003's unused 3 back to Unrestricted), nothing held", [r.code, wc.calls.length, wc.calls[0] && wc.calls[0].operation_key,
    wc.calls[0] && wc.calls[0].movements.map((m) => [m.movement_key, m.direction, m.inventory_category, m.material_id, m.location_id, m.quantity, m.transaction_type])],
    ["200", 1, "IAH|" + IA + "|1", [["X1", "SUBTRACT", "Reserved", I2, B1, 5, "IA-H"], ["X1.2", "ADD", "Unrestricted", I2, B1, 5, "IA-H"], ["X2", "SUBTRACT", "Reserved", I1, B2, 3, "IA-H"],
      ["X2.2", "ADD", "Unrestricted", I1, B2, 3, "IA-H"]]]);
  eq("CLOSE: R1 Delivered 6, R2 Cancelled, R3 Delivered 1 (its unused 3 a Cancelled remainder); the stock back", [rowsOf(wc), wc.bal[kB], wc.bal[kC], wc.bal[kA]],
    [[["R1", "Delivered", 6, 0, 6], ["R2", "Cancelled", 5, 0, 0], ["R3", "Delivered", 1, 0, 1], ["new", "Cancelled", 3, 0, 0]], { Unrestricted: 5, Reserved: 0, Blocked: 0 },
      { Unrestricted: 3, Reserved: 0, Blocked: 0 }, { Unrestricted: 4, Reserved: 0, Blocked: 0 }]);
  eq("CLOSE: the delivered rows carry the completed number; the remainder points at its row", [wc.rows.filter((x) => x.status === "Delivered").map((x) => x.doc_no),
    wc.rows.find((x) => x.id !== id("01") && x.id !== id("02") && x.id !== id("03")).source_reserved_id], [[NO, NO], id("03")]);
  eq("CLOSE: the header CLOSED, the ticket FREE, the result says closed", [wc.ia.hold, wc.tickets.map((x) => [x.step_name, x.step_status]), r.message, r.result.status],
    ["CLOSED", [["TICKET|1", "FREE"]], "Closed: what the completion used is delivered and the rest is released.", "CLOSED"]);
  r = close(wc);
  eq("CLOSE again: nothing held, nothing moved", [r.code, /Nothing held/.test(r.message), wc.calls.length], ["200", true, 1]);
  // ---- the release refused (someone took reserved stock meanwhile): the deliveries stand, the rest restored; a retry never delivers twice
  wc = completed({ bal: { [kA]: { Unrestricted: 4, Reserved: 0, Blocked: 0 }, [kB]: { Unrestricted: 0, Reserved: 2, Blocked: 0 }, [kC]: { Unrestricted: 0, Reserved: 3, Blocked: 0 } } });
  r = close(wc);
  eq("CLOSE refused (only 2 of R2's 5 still reserved): Needs review, R1 / R3 delivered, R2 and the remainder still held", [wc.ia.hold, /could not be released \(INSUFFICIENT\)/.test(r.message),
    rowsOf(wc)], ["REVIEW", true, [["R1", "Delivered", 6, 0, 6], ["R2", "Allocated", 5, 5, 0], ["R3", "Delivered", 1, 0, 1], ["new", "Allocated", 3, 3, 0]]]);
  eq("CLOSE refused: the result counts what is still held per line (delivered ones not, the restored remainder yes)", r.result.lines.map((x) => [x.lineId, x.reserved]),
    [["3001", 0], ["3002", 5], ["3003", 3]]);
  wc.bal[kB].Reserved = 5;
  r = close(wc);
  eq("CLOSE retried: R2's 5 and the remainder's 3 released, no second delivery, CLOSED", [wc.calls.length, wc.calls[1].movements.filter((m) => m.direction === "SUBTRACT").map((m) => [m.material_id, m.location_id, m.quantity]),
    rowsOf(wc), wc.ia.hold], [2, [[I2, B1, 5], [I1, B2, 3]], [["R1", "Delivered", 6, 0, 6], ["R2", "Cancelled", 5, 0, 0], ["R3", "Delivered", 1, 0, 1], ["new", "Cancelled", 3, 0, 0]], "CLOSED"]);
  // ---- everything used: no stock to move, the rows delivered under the ticket
  const wu = completed({ lines: [line("3001", I1, [pick(B1, 6)])], rows: [own("01", "3001", I1, B1, 6)], moves: [mv("01", I1, B1, "6")] });
  r = close(wu);
  eq("CLOSE, all used: no engine call, R1 Delivered, CLOSED, the ticket taken and freed", [wu.calls.length, rowsOf(wu), wu.ia.hold, wu.tickets.map((x) => x.step_status)],
    [0, [["R1", "Delivered", 6, 0, 6]], "CLOSED", ["FREE"]]);
  // ---- more issued from Reserved than held: what can be is closed, the rest named for review
  const wo = completed({ lines: [line("3001", I1, [pick(B1, 6)])], rows: [own("01", "3001", I1, B1, 6)], moves: [mv("01", I1, B1, "8")] });
  r = close(wo);
  eq("CLOSE, 8 issued against a hold of 6: R1 Delivered 6, Needs review names the key", [rowsOf(wo), wo.ia.hold, r.message.indexOf(kA) >= 0, /more reserved stock than/.test(r.message)],
    [[["R1", "Delivered", 6, 0, 6]], "REVIEW", true, true]);
  // ---- a reverted earlier cycle under the same number: its movements and its Delivered rows are not this cycle's
  const old = Object.assign(own("00", "3001", I1, B1, 6), { id: "2112800000000000050", status: "Delivered", doc_no: NO, open_qty: "0", delivered_qty: "6" });
  const wr = completed({ lines: [line("3001", I1, [pick(B1, 6)])], rows: [old, own("01", "3001", I1, B1, 6, { id: "2112800000000000700" })],
    moves: [mv("01", I1, B1, "6", { id: "2112800000000000060" }), { id: "2112800000000000070", trx_no: NO, transaction_type: "IA-R", movement: "IN", inventory_category: "Unrestricted",
      item_id: I1, bin: B1, batch: null, base_qty: "6", org: ORG }, mv("02", I1, B1, "2", { id: "2112800000000000800" })],
    bal: { [kA]: { Unrestricted: 4, Reserved: 4, Blocked: 0 } } });
  r = close(wr);
  eq("CLOSE after a revert: only this cycle's 2 delivered, its other 4 released", [wr.rows.filter((x) => !x.is_deleted && x.id === "2112800000000000700").map((x) => [x.status, q8(x.delivered_qty)]),
    wr.calls[0] && wr.calls[0].movements.filter((m) => m.direction === "SUBTRACT").map((m) => m.quantity), wr.ia.hold], [[["Delivered", 2]], [4], "CLOSED"]);
  // review M1: an older Blocked hold (its line removed before completing) and an Unrestricted hold of one item at one bin; the
  // completion issued 5 from Reserved for the Unrestricted pick: that hold is delivered, the Blocked one goes back to Blocked
  const wm = completed({ lines: [line("3001", I1, [pick(B1, 5)])], rows: [own("00", "3004", I1, B1, 5, { from_category: "Blocked" }), own("01", "3001", I1, B1, 5)],
    moves: [mv("01", I1, B1, "5")], bal: { [kA]: { Unrestricted: 0, Reserved: 5, Blocked: 0 } } });
  r = close(wm);
  eq("CLOSE by the completion's split: the Unrestricted hold Delivered, the older Blocked hold back to Blocked", [wm.rows.filter((x) => !x.is_deleted)
    .map((x) => [x.id.slice(-2), x.status, q8(x.delivered_qty)]), wm.bal[kA], wm.ia.hold],
    [[["00", "Cancelled", 0], ["01", "Delivered", 5]], { Unrestricted: 0, Reserved: 0, Blocked: 5 }, "CLOSED"]);
  // ---- refusals
  const wd = new World({ rows: [own("01", "3001", I1, B1, 6)] });
  r = close(wd);
  eq("CLOSE on a Draft: 200 nothing to close, nothing read or moved", [r.code, /Nothing to close/.test(r.message), wd.calls.length, !!wd.sqls.consumed], ["200", true, 0, false]);
  const wq = completed({ ia: { status: "Completed", no: "IA'1 OR '1", hold: "FULL" } });
  r = close(wq);
  eq("CLOSE with a number that cannot go into SQL text: Needs review, the number never read, nothing moved", [wq.ia.hold, !!wq.sqls.consumed, wq.calls.length, /number/.test(r.message)],
    ["REVIEW", false, 0, true]);
  const wh = completed();
  hold(wh);
  eq("RECONCILE on a Completed IA: nothing to reserve, the CLOSE read not made", [!!wh.sqls.consumed, wh.calls.length], [false, 0]);
  // ---- a dead CLOSE run: its Releasing rows resolved from the engine's record, never released twice
  const deadOp = "IAH|" + IA + "|3";
  const deadRows = () => [Object.assign(own("01", "3001", I1, B1, 6), { status: "Delivered", doc_no: NO, open_qty: "0", delivered_qty: "6", reserved_qty: "6" }),
    Object.assign(own("02", "3002", I2, B1, 5), { status: "Releasing", job_line_key: deadOp + "|" + id("02") }),
    Object.assign(own("03", "3003", I1, B2, 1), { status: "Delivered", doc_no: NO, open_qty: "0", delivered_qty: "1", reserved_qty: "1" }),
    Object.assign(own("09", "3003", I1, B2, 3), { id: "3000000000000000099", status: "Releasing", job_line_key: deadOp + "|1", source_reserved_id: id("03") })];
  const wx = completed({ rows: deadRows(), ops: { [deadOp]: { done: 1, intents: 4 } }, bal: { [kA]: { Unrestricted: 4, Reserved: 0, Blocked: 0 }, [kB]: { Unrestricted: 5, Reserved: 0, Blocked: 0 },
    [kC]: { Unrestricted: 3, Reserved: 0, Blocked: 0 } } });
  r = close(wx);
  eq("a dead CLOSE that moved: its rows Cancelled, nothing released again, CLOSED", [wx.calls.length, rowsOf(wx).map((x) => x[1]), wx.ia.hold], [0, ["Delivered", "Cancelled", "Delivered", "Cancelled"], "CLOSED"]);
  const wn = completed({ rows: deadRows(), ops: {} });
  r = close(wn);
  eq("a dead CLOSE that moved nothing: its rows back, then released once (5 + 3), no second delivery", [wn.calls.length, wn.calls[0] && wn.calls[0].movements.filter((m) => m.direction === "SUBTRACT")
    .map((m) => m.quantity), rowsOf(wn).map((x) => [x[1], x[4]]), wn.ia.hold], [1, [5, 3], [["Delivered", 6], ["Cancelled", 0], ["Delivered", 1], ["Cancelled", 0]], "CLOSED"]);
}
console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
