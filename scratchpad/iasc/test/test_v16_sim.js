// node scratchpad/iasc/test/test_v16_sim.js - IA_SAVE v16 (transfer requests from a reserved IA, RESERVED_REQUEST_PLAN.md Task 8) against
// v15 (= dev v27) in the iav2 FlowGram interpreter: every save without a request (or with only Cancelled / other IAs' ones) runs like v15
// (same answer, same steps, same writes, same callee calls); a save while a request is in transit is refused 400 IA_TR_TRANSIT - a Draft
// save too - and a completion while one is open IA_TR_OPEN, before any write or call; a Created save while Requested, or after a receipt,
// goes on; a completion after a receipt needs every line a request can carry at the staging bin (D11, IA_TR_STAGING), serial and HU lines
// excepted. Both reads are emulated from the SQL text the node sends (gate, filters, first line, the items asked for); like the platform,
// an sql-node keeps only its declared columns. Builds both into a temp folder (IA_V15 / IA_V16 = given files).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IASC = path.join(__dirname, "..");
const IAV2 = path.join(IASC, "..", "iav2");
const { Engine } = require(path.join(IAV2, "lib", "sim", "engine.js"));

const built = (script, env) => {
  if (process.env[env]) return process.env[env];
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ia-" + env.toLowerCase() + "-"));
  const r = spawnSync("python3", [path.join(IASC, "classic", script), "--write"], { env: Object.assign({}, process.env, { IASC_OUT: out }), encoding: "utf8" });
  if (r.status !== 0) throw new Error(script + ": " + r.stderr.slice(-1200));
  return path.join(out, "IA_SAVE.json");
};
const SRC15 = built("patch_v15.py", "IA_V15");
const SRC16 = built("patch_v16.py", "IA_V16");
const variant = (src, res, claim) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ia-v16v-")), "IA_SAVE.json");
  fs.writeFileSync(f, fs.readFileSync(src, "utf8").replace(/const RES_ENABLED = (true|false);/g, "const RES_ENABLED = " + res + ";")
    .replace(/const IA_CLAIM_ENABLED = (true|false);/g, "const IA_CLAIM_ENABLED = " + claim + ";"));
  return f;
};
const V15 = variant(SRC15, false, false);
const V16 = variant(SRC16, false, false);
const V15_CL = variant(SRC15, true, true);
const V16_CL = variant(SRC16, true, true);

const T = "000000";
const UID = "2109866916722085890";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const IA = "2112073133161844738";
const PARENT = "2094626841323700251";
const COMP = "2094626841323700252";
const COMP2 = "2094626841323700253";
const SERIAL = "2094626841323700254";
const LINE1 = "2112073133161844801";
const LINE2 = "2112073133161844802";
const BIN = "2018912822846582786";
// one above BIN: the same double (spacing 256 near 2e18) - only an exact (text) compare tells them apart
const NEIGHBOUR = "2018912822846582787";
const WH = "2018912822846583999";
const SL = "2018912759311265793";
const UOM = "2018906563477008392";
const LOT1 = "2113300000000000001";
const LOT2 = "2113300000000000002";

let fails = 0;
let n = 0;
const eq = (label, got, want) => {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fails++;
    console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1200) + "\n  want " + JSON.stringify(want).slice(0, 1200));
  }
};
const yes = (label, v) => eq(label, !!v, true);

// the rows a request read's text asks for (a predicate missing from the text filters nothing, as MySQL would read it)
const rowsOf = (q, sc) => {
  const ten = (/rq\.tenant_id = '(\w*)'/.exec(q) || [])[1];
  const ia = (/rq\.source_ia_id = '(\w*)'/.exec(q) || [])[1];
  let rows = (sc.requests || []).filter((r) => (ten === undefined || r.tenant === ten) && (ia === undefined || r.source === ia));
  if (/rq\.is_deleted = 0/.test(q)) rows = rows.filter((r) => !r.deleted);
  if (/rq\.transfer_purpose = 'IA_SUPPLY'/.test(q)) rows = rows.filter((r) => r.purpose === "IA_SUPPLY");
  return rows;
};
const firstLine = (r, q) => {
  const lines = r.lines.filter((l) => !(l.deleted && /rl\.is_deleted = 0/.test(q)));
  return lines.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[/MIN\(rl\.id\) AS first_id/.test(q) ? 0 : lines.length - 1] || null;
};
// v15's read: the latest request that is not Cancelled
const requestRead = (q, sc) => {
  if (/COALESCE\(rq\.stock_movement_status, ''\) <> 'Cancelled'/.test(q) === false) throw new Error("v15's read without its Cancelled filter");
  const rows = rowsOf(q, sc).filter((r) => r.status !== "Cancelled").sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1));
  const r = rows[0];
  if (!r) return null;
  const f = firstLine(r, q);
  const lines = r.lines.filter((l) => !(l.deleted && /rl\.is_deleted = 0/.test(q)));
  return JSON.stringify({ id: r.id, no: r.no, bin: f ? f.loc : null, lines: lines.length ? lines.map((l) => l.src) : null, status: r.status === undefined ? null : r.status,
    bin_name: f ? (sc.binNames || {})[f.loc] || null : null });
};
// v16's read: every request (first line's bin + its name) and the flags of the items the text asks for
const requestsRead = (q, sc) => {
  const reqs = rowsOf(q, sc).map((r) => {
    const f = firstLine(r, q);
    return { id: r.id, no: r.no, status: r.status === undefined ? null : r.status, bin: f ? f.loc : null, bin_name: f ? (sc.binNames || {})[f.loc] || null : null };
  });
  const ids = ((/ri\.id IN \(([0-9,]*)\)/.exec(q) || [])[1] || "").split(",").filter((x) => x);
  const items = (sc.items || []).filter((it) => ids.indexOf(it.id) >= 0 && /ri\.is_deleted = 0/.test(q))
    .map((it) => ({ id: it.id, stock_control: it.stock_control, serial_number_management: it.serial_number_management || 0 }));
  return JSON.stringify({ reqs: reqs.length ? reqs : null, items: items.length ? items : null });
};
const guardRead = (text, sc) => {
  const q = String(text || "").replace(/\s+/g, " ");
  if (!/\bAS iatr\b/.test(q)) return null;
  const gate = /IF\('(\w*)' = 'YES' OR h\.item_assembly_status <> 'Draft', \(SELECT/.exec(q);
  if (!gate) throw new Error("the request read without its gate: " + q.slice(0, 400));
  sc.gates.push(gate[1]);
  if (!(gate[1] === "YES" || (sc.stored !== null && sc.stored !== undefined && sc.stored !== "Draft"))) return null;
  if (sc.iatrText !== undefined) return sc.iatrText;
  const text2 = /'reqs', \(SELECT/.test(q) ? requestsRead(q, sc) : requestRead(q, sc);
  return text2 !== null && sc.bare ? text2.replace(/"(\d{16,})"/g, "$1") : text2;
};

class Sim extends Engine {
  constructor(file, sc) {
    const writes = [];
    const calls = [];
    sc.steps = sc.steps || [];
    sc.gates = [];
    sc.reads = [];
    let addNo = 0;
    const db = {
      tenantId: T,
      uid: UID,
      insert: (table, rows) => rows.map((r0, i) => {
        if (table === "GD Publish Step" && sc.steps.some((x) => x.job_id === r0.job_id && x.step_name === r0.step_name)) throw new Error("Duplicate entry for key 'Job Step'");
        const r = Object.assign({}, r0, { id: String(3000000000000000001n + BigInt(writes.length + i)) });
        if (r.stock_movement_no === "issued") r.stock_movement_no = "IA-0001";
        if (r.stock_movement_no === "draft") r.stock_movement_no = "Draft-0001";
        writes.push(["insert", table, r]);
        if (table === "GD Publish Step") sc.steps.push(Object.assign({ is_deleted: 0 }, r));
        return r;
      }),
      update: (table, rows) => {
        for (const r of rows) {
          writes.push(["update", table, r]);
          if (table === "GD Publish Step") sc.steps.filter((x) => x.id === r.id).forEach((x) => Object.assign(x, r));
        }
        return { count: rows.length };
      },
    };
    const stored = () => ({ id: IA, item_assembly_status: sc.stored, stock_movement_no: "IA-0009", stock_movement: [] });
    super({
      dir: path.dirname(file), db,
      mocks: {
        sql: {
          sql_node_IAguard: (text) => {
            sc.reads.push(text);
            if (sc.stored === null) return [];
            const iatr = guardRead(text, sc);
            return [Object.assign({ ia_id: IA, item_assembly_status: sc.stored }, /h\.stock_movement_no\b/.test(String(text || "")) ? { stock_movement_no: "IA-0009" } : {},
              iatr === null ? {} : { iatr: iatr })];
          },
          sql_node_RESown: () => [{ j: JSON.stringify({ rows: null, live: 0 }) }],
          sql_node_IAclaimState: () => {
            const mine = sc.steps.filter((x) => x.job_id === "IAS|" + IA && /^CLAIM\|/.test(x.step_name));
            return [{ j: JSON.stringify({ max: mine.reduce((m, x) => Math.max(m, Number(x.step_name.slice(6))), 0), now: "2026-10-30 14:00:00" }) }];
          },
          sql_node_IAclaims: () => {
            const held = sc.steps.filter((x) => x.job_id === "IAS|" + IA && /^CLAIM\|/.test(x.step_name) && x.step_status === "HELD" && !Number(x.is_deleted));
            return [{ j: JSON.stringify({ claims: held.length ? held.map((x) => ({ id: x.id, name: x.step_name, started_at: x.started_at })) : null, status: sc.stored,
              now: "2026-10-30 14:00:00" }) }];
          },
          sql_node_SCsource: (text) => {
            const iaId = (/h\.id = (\d+)/.exec(text) || [])[1];
            let st = iaId && iaId !== "0" ? { item_id: PARENT } : null;
            if (st && /'output_split', h\.output_split, 'plant', CAST\(h\.issuing_operation_faci AS CHAR\), 'bin', CAST\(h\.location_id AS CHAR\)/.test(text)) {
              st = Object.assign(st, { output_split: null, plant: PLANT, bin: BIN });
            }
            return [{ j: JSON.stringify({ member: 1, stored: st, line: null, header: null, keys: null, hold: null }) }];
          },
        },
        read: {
          search_items: () => ({ total: sc.items.length, count: sc.items.length, data: sc.items }),
          get_persisted_ia: () => ({ count: 1, data: stored() }),
          get_ia: () => ({ count: 1, data: stored() }),
          search_movements: () => ({ total: 1, count: 1, data: [{ total_price: 6, movement: "OUT" }] }),
        },
      },
    });
    this.file = file;
    this.sc = sc;
    this.writes = writes;
    this.calls = calls;
    this.next = { add: () => (sc.addAnswers || [])[addNo++] || { code: "200", unitPrice: 0 } };
  }

  load(name) {
    if (name === "IA_SAVE") return JSON.parse(fs.readFileSync(this.file, "utf8"));
    if (name === "CHECK_REQUIRED_FIELD") return JSON.parse(fs.readFileSync(path.join(IAV2, "base", "CHECK_REQUIRED_FIELD.v8.json"), "utf8"));
    throw new Error("no workflow " + name);
  }

  run(name, params) {
    const fixed = { GLOBAL_INVENTORY_VALIDATION: { code: "200", message: "Sufficient stock" }, SUBTRACT_INVENTORY: { code: "200" }, HANDLING_UNIT: { code: "200" },
      GENERATE_BATCH: { batch_number: "B-0001" } }[name];
    const stub = name === "ADD_INVENTORY" ? this.next.add() : fixed;
    if (stub) {
      this.calls.push([name, JSON.parse(JSON.stringify(params))]);
      return { returned: stub, ctx: null };
    }
    return super.run(name, params);
  }

  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined ? "null" : JSON.stringify(v);
    });
  }

  node(nd, ctx) {
    const d = nd.data || {};
    if (nd.type === "if" && d.condition_type === "ConditionRule") {
      const leaf = d.filter.list[0];
      const v = this.resolve(leaf.prop.replace(/^(workflowparams|node)\./, "$1:"), ctx);
      const ok = leaf.operator === "equal" ? String(v) === String(leaf.value) : leaf.operator === "notEqual" ? String(v) !== String(leaf.value) : null;
      if (ok === null) throw new Error("operator " + leaf.operator);
      this.trace.push(ctx.name + " " + nd.id);
      return this.block(nd.blocks[ok ? 0 : 1].blocks, ctx);
    }
    if (nd.type === "if") this.trace.push(ctx.name + " " + nd.id);
    super.node(nd, ctx);
    if (nd.type === "sql-node") {
      const names = (d.response_json || []).map((r) => r.name).filter((x) => x);
      const rows = ctx.out[nd.id];
      if (names.length && Array.isArray(rows)) ctx.out[nd.id] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => names.indexOf(k) >= 0)));
    }
  }
}

const pk = (loc, qty, o) => Object.assign({ material_id: COMP, location_id: loc, batch_id: null, balance_id: "9000", sm_quantity: qty === undefined ? 1 : qty, category: "Unrestricted" },
  o || {});
const lineOf = (id, comp, name, picks, extra) => Object.assign({ item_selection: comp, item_name: name, total_quantity: picks.reduce((s, p) => s + p.sm_quantity, 0),
  requested_qty: 1, quantity_uom: UOM, temp_qty_data: JSON.stringify(picks), temp_hu_data: "", line_index: 1 }, id ? { id: id } : {}, extra || {});
const record = (page, lines, extra) => Object.assign({
  organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: "", stock_movement_no_type: "2098266711093927937",
  item_assembly_status: page === "Add" ? "" : "Draft", item_id: PARENT, item_name: "TES500", item_desc: "", item_qty: 1, item_uom: UOM, item_assembly_date: "2026-10-30",
  issued_by: "sim", project_id: "", batch_no: "", storage_location_id: SL, location_id: BIN, inventory_category: "Unrestricted",
  remarks: "r1", remarks_2: "", remarks_3: "", reference_documents: [], page_status: page, output_split: [], stock_movement: lines,
}, page === "Add" ? {} : { id: IA }, extra || {});
const two = (loc1, loc2) => [lineOf(LINE1, COMP, "TES501", [pk(loc1, 2)]), lineOf(LINE2, COMP2, "TES502", [pk(loc2, 1, { material_id: COMP2 })])];
const item = (extra) => Object.assign({ id: PARENT, material_code: "TES500", stock_control: 1, item_batch_management: 0, batch_number_genaration: "", assembly_cost: 0,
  serial_number_management: 0, based_uom: UOM, table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }] }, extra || {});
const ITEMS = [item(), { id: COMP, material_code: "TES501", stock_control: 1, item_batch_management: 0, batch_number_genaration: "", serial_number_management: 0 },
  { id: COMP2, material_code: "TES502", stock_control: 1, item_batch_management: 0, batch_number_genaration: "", serial_number_management: 0 },
  { id: SERIAL, material_code: "TES503", stock_control: 1, item_batch_management: 0, batch_number_genaration: "", serial_number_management: 1 }];
const req = (id, no, status, lines, extra) => Object.assign({ id: id, no: no, status: status, tenant: T, source: IA, purpose: "IA_SUPPLY", deleted: false,
  lines: lines || [{ id: String(BigInt(id) + 100n), src: LINE1, loc: BIN }] }, extra || {});
const BIN_NAMES = { [BIN]: "PROD-A1", [WH]: "WH-01", [NEIGHBOUR]: "PROD-A2" };

function go(file, sc) {
  const e = new Sim(file, Object.assign({ items: ITEMS, binNames: BIN_NAMES }, sc));
  let r;
  try {
    r = e.run("IA_SAVE", { allData: sc.allData, saveAs: sc.saveAs, pageStatus: sc.pageStatus });
  } catch (err) {
    r = { returned: { crashed: String(err.message).slice(0, 300) } };
  }
  const steps = e.trace.filter((t) => t.startsWith("IA_SAVE ")).map((t) => t.slice(8));
  return { returned: r.returned, steps: steps, writes: e.writes, calls: e.calls, gates: e.sc.gates, reads: e.sc.reads };
}
const stamp = (w) => JSON.parse(JSON.stringify(w).replace(/"last_transaction_date":"[^"]*"/g, '"last_transaction_date":"<now>"'));
// the twin: v16 on `sc`, v15 on `sc15` (default the same scenario)
const sameAsV15 = (label, sc, sc15, files) => {
  const [a15, a16] = files || [V15, V16];
  const a = go(a15, JSON.parse(JSON.stringify(sc15 || sc)));
  const b = go(a16, JSON.parse(JSON.stringify(sc)));
  eq(label + ": answer == v15", b.returned, a.returned);
  eq(label + ": steps == v15", b.steps, a.steps);
  eq(label + ": writes == v15", stamp(b.writes), stamp(a.writes));
  eq(label + ": callee calls == v15", b.calls, a.calls);
  return b;
};
const refused = (label, res, code, re) => {
  eq(label + ": 400", res.returned && res.returned.code, "400");
  yes(label + ": its message (" + ((res.returned && res.returned.message) || JSON.stringify(res.returned)) + ")", re.test((res.returned && res.returned.message) || ""));
  eq(label + ": nothing written, no callee (no stock call)", [res.writes.length, res.calls.length], [0, 0]);
  yes(label + ": refused in the guard, before code_fillback", res.steps.indexOf("code_fillback") < 0);
};
const named = (res, wf) => res.calls.filter((c) => c[0] === wf).map((c) => c[1]);
const edit = (saveAs, lines, extra, sc) => Object.assign({ stored: "Draft", saveAs: saveAs, pageStatus: "Edit", allData: record("Edit", lines, extra) }, sc || {});
const created = (lines, sc) => edit("Draft", lines, { item_assembly_status: "Created" }, Object.assign({ stored: "Created" }, sc || {}));
const TRANSIT_RE = (no, st) => new RegExp("^The materials of this Item Assembly are being transferred \\(transfer request " + no + " is " + st + "\\): it can't be changed until that request is received\\.$");
const OPEN_RE = (no, st) => new RegExp("^Transfer request " + no + " of this Item Assembly is " + st + ": receive it or cancel it before completing the Item Assembly\\.$");
const STAGING_RE = (nLine, item, bin, no) => new RegExp("^Line " + nLine + " \\(" + item + "\\): take it from " + bin + ", where transfer request " + no + " delivered the materials");

// ---- the declared shapes
{
  const idx = (f) => {
    const out = {};
    const walk = (x) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        if (typeof x.id === "string" && x.type) out[x.id] = x;
        Object.values(x).forEach(walk);
      }
    };
    walk(JSON.parse(fs.readFileSync(f, "utf8")).nodes);
    return out;
  };
  const A = idx(SRC15);
  const B = idx(SRC16);
  eq("no node added or removed", Object.keys(B).sort(), Object.keys(A).sort());
  eq("declared: the guard input's trItems (string)", B.code_node_IAguardIn.data.response_json.map((r) => [r.name, r.bsonType]).slice(-1), [["trItems", "string"]]);
}

// ================================================================ no request: v15 save for save
let r = sameAsV15("Add, Completed (no stored read)", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", two(WH, WH)) });
eq("Add: completed, no guard read", [r.returned.code, r.reads.length], ["200", 0]);
r = sameAsV15("Edit, stored Draft, Completed", edit("Completed", two(WH, WH)));
eq("Edit Completed: the gate YES, completed", [r.returned.code, r.gates], ["200", ["YES"]]);
yes("  the read asks for the save's items", /ri\.id IN \(2094626841323700252,2094626841323700253\)/.test(r.reads[0].replace(/\s+/g, " ")));
r = sameAsV15("Edit, stored Draft, Draft", edit("Draft", two(WH, WH)));
eq("Edit Draft of a stored Draft: the gate NO", r.gates, ["NO"]);
sameAsV15("Edit, stored Draft, Created (the Draft path)", edit("Draft", two(WH, WH), { ia_target_status: "Created" }));
sameAsV15("Edit, stored Created, Draft path (stays Created)", created(two(WH, WH)));
sameAsV15("Edit, Completed, claim + holds ON", edit("Completed", two(WH, WH)), null, [V15_CL, V16_CL]);
sameAsV15("Edit, Completed, the receipt refused (400)", edit("Completed", two(WH, WH), {}, { addAnswers: [{ code: "400", errorMessage: "no bin" }] }));
sameAsV15("Edit, stored Processing (the busy guard)", edit("Completed", two(WH, WH), {}, { stored: "Processing" }));
sameAsV15("Edit, stored Completed saved as Draft (409)", edit("Draft", two(WH, WH), { item_assembly_status: "Completed" }, { stored: "Completed" }));
const others = [req(LOT1, "LOT-R1", "Cancelled"), req(LOT2, "LOT-R2", "In Progress", null, { source: "2112073133161844799" }),
  req("2113300000000000003", "LOT-R3", "In Progress", null, { purpose: "" }), req("2113300000000000004", "LOT-R4", "In Progress", null, { deleted: true }),
  req("2113300000000000005", "LOT-R5", "In Progress", null, { tenant: "000001" })];
r = sameAsV15("Completed, only a Cancelled request + other IAs' / purposes' / deleted / tenants' ones", edit("Completed", two(WH, WH), {}, { requests: others }));
eq("  completed (picks anywhere)", r.returned.code, "200");
sameAsV15("Created, only a Cancelled request", edit("Draft", two(WH, WH), { ia_target_status: "Created" }, { requests: [req(LOT1, "LOT-R1", "Cancelled")] }));

// ================================================================ in transit (D4): any save refused
for (const st of ["In Progress", "Processing"]) {
  refused("a Draft save of a Created IA while " + st, go(V16, edit("Draft", two(BIN, BIN), {}, { stored: "Created", requests: [req(LOT1, "LOT-R1", st)] })), "IA_TR_TRANSIT",
    TRANSIT_RE("LOT-R1", st));
  refused("a Created save while " + st, go(V16, created(two(BIN, BIN), { requests: [req(LOT1, "LOT-R1", st)] })), "IA_TR_TRANSIT", TRANSIT_RE("LOT-R1", st));
  refused("a completion while " + st, go(V16, edit("Completed", two(BIN, BIN), {}, { stored: "Created", requests: [req(LOT1, "LOT-R1", st)] })), "IA_TR_TRANSIT",
    TRANSIT_RE("LOT-R1", st));
}
refused("a replacement in transit after a receipt", go(V16, created(two(BIN, WH), { requests: [req(LOT1, "LOT-R1", "Completed"), req(LOT2, "LOT-R2", "In Progress")] })),
  "IA_TR_TRANSIT", TRANSIT_RE("LOT-R2", "In Progress"));
refused("a status the guard does not know: in transit (fail closed)", go(V16, created(two(BIN, BIN), { requests: [req(LOT1, "LOT-R1", "Draft")] })), "IA_TR_TRANSIT",
  TRANSIT_RE("LOT-R1", "Draft"));
refused("claim + holds ON: refused before the claim", go(V16_CL, edit("Completed", two(BIN, BIN), {}, { stored: "Created", requests: [req(LOT1, "LOT-R1", "In Progress")] })),
  "IA_TR_TRANSIT", TRANSIT_RE("LOT-R1", "In Progress"));

// ================================================================ Requested (before dispatch): Created goes on, completion refused
r = sameAsV15("a Created save while Requested goes on (D4: the request then refreshes) = v15 without the request", created(two(WH, WH), { requests: [req(LOT1, "LOT-R1", "Requested")] }),
  created(two(WH, WH)));
eq("  saved", r.returned.code, "200");
sameAsV15("a Draft save of a Created IA while Requested goes on", edit("Draft", two(WH, WH), {}, { stored: "Created", requests: [req(LOT1, "LOT-R1", "Requested")] }),
  edit("Draft", two(WH, WH), {}, { stored: "Created" }));
refused("a completion while Requested -> IA_TR_OPEN", go(V16, edit("Completed", two(BIN, BIN), {}, { stored: "Created", requests: [req(LOT1, "LOT-R1", "Requested")] })),
  "IA_TR_OPEN", OPEN_RE("LOT-R1", "Requested"));
refused("a completion with a replacement Requested after a receipt -> IA_TR_OPEN", go(V16, edit("Completed", two(BIN, BIN), {}, { stored: "Created",
  requests: [req(LOT1, "LOT-R1", "Completed"), req(LOT2, "LOT-R2", "Requested")] })), "IA_TR_OPEN", OPEN_RE("LOT-R2", "Requested"));

// ================================================================ after a receipt (D11): the completion at the staging bin
const RECEIVED = () => [req(LOT1, "LOT-R1", "Completed", [{ id: "2113300000000000011", src: LINE1, loc: BIN }])];
r = sameAsV15("every requestable line at the staging bin: completes as v15", edit("Completed", two(BIN, BIN), {}, { stored: "Created", requests: RECEIVED() }));
eq("  its picks issued from the staging bin", [r.returned.code, named(r, "SUBTRACT_INVENTORY").map((p) => p.location_id)], ["200", [BIN, BIN]]);
refused("a never-reserved line picked in the warehouse -> IA_TR_STAGING (v15 let it pass)", go(V16, edit("Completed", two(BIN, WH), {}, { stored: "Created", requests: RECEIVED() })),
  "IA_TR_STAGING", STAGING_RE(2, "TES502", "PROD-A1", "LOT-R1"));
r = sameAsV15("a serial line from the warehouse: completes as v15", edit("Completed", [lineOf(LINE1, COMP, "TES501", [pk(BIN, 2)]),
  lineOf(LINE2, SERIAL, "TES503", [pk(WH, 1, { material_id: SERIAL })])], {}, { stored: "Created", requests: RECEIVED() }));
eq("  completed", r.returned.code, "200");
sameAsV15("a handling-unit line from the warehouse: completes as v15", edit("Completed", [lineOf(LINE1, COMP, "TES501", [pk(BIN, 2)]),
  lineOf(LINE2, COMP2, "TES502", [pk(WH, 1, { material_id: COMP2, handling_unit_id: "77" })])], {}, { stored: "Created", requests: RECEIVED() }));
sameAsV15("a Created save after a receipt with warehouse picks (a replacement's new reservation) goes on = v15 without the request",
  created(two(BIN, WH), { requests: RECEIVED() }), created(two(BIN, WH)));
refused("bare 19-digit numbers: the neighbouring bin is not the staging bin", go(V16, edit("Completed", two(BIN, NEIGHBOUR), {}, { stored: "Created", requests: RECEIVED(), bare: true })),
  "IA_TR_STAGING", STAGING_RE(2, "TES502", "PROD-A1", "LOT-R1"));
refused("the staging bin is the newest received request's", go(V16, edit("Completed", two(BIN, BIN), {}, { stored: "Created",
  requests: [req(LOT1, "LOT-R1", "Completed"), req(LOT2, "LOT-R2", "Completed", [{ id: "2113300000000000021", src: LINE1, loc: WH }])] })), "IA_TR_STAGING",
  STAGING_RE(1, "TES501", "WH-01", "LOT-R2"));
// the staging bin = the newest received request's first line (by id, not deleted)
const outOfOrder = () => [req(LOT1, "LOT-R1", "Completed", [{ id: "2113300000000000012", src: LINE2, loc: NEIGHBOUR }, { id: "2113300000000000011", src: LINE1, loc: BIN }])];
r = go(V16, edit("Completed", two(BIN, BIN), {}, { stored: "Created", requests: outOfOrder() }));
eq("the staging bin is the first line's (by id), not the last", r.returned.code, "200");
const withDeleted = () => [req(LOT1, "LOT-R1", "Completed", [{ id: "2113300000000000011", src: LINE1, loc: WH, deleted: true }, { id: "2113300000000000012", src: LINE2, loc: BIN }])];
r = go(V16, edit("Completed", two(BIN, BIN), {}, { stored: "Created", requests: withDeleted() }));
eq("a deleted request line is not the staging bin", r.returned.code, "200");
r = sameAsV15("an IA already Completed, completed again: v15's own answer", edit("Completed", two(WH, WH), { item_assembly_status: "Completed" }, { stored: "Completed", requests: RECEIVED() }));
refused("an unreadable read: a completion refused", go(V16, edit("Completed", two(BIN, BIN), {}, { stored: "Created", iatrText: "{truncated" })), "IA_TR_UNREADABLE",
  /^The transfer requests of this Item Assembly could not be read/);

console.log((fails ? "FAILED " : "ok - ") + (n - fails) + "/" + n + " checks");
process.exit(fails ? 1 : 0);
