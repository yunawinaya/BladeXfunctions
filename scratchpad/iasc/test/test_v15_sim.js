// node scratchpad/iasc/test/test_v15_sim.js - IA_SAVE v15 (the IA transfer request guard, ENH-20261027-001) against v14 (= the deployed
// dev v26 / prod v12) in the iav2 FlowGram interpreter: every save without a request (or with only Cancelled ones), and every Draft save,
// runs like v14 (same answer, same steps minus the guard's new nodes, same writes, same callee calls); a Created / Completed save while the
// request still moves is refused 400 before any write or call; a received one refuses picks of its lines away from its destination bin and
// otherwise runs as v14. The guard's read is emulated from the SQL text the node sends (its gate, filters, order, first line) and, like
// the platform, an sql-node keeps only its declared columns. Builds both into a temp folder (IA_V14 / IA_V15 = given files).
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
const SRC14 = built("patch_v14.py", "IA_V14");
const SRC15 = built("patch_v15.py", "IA_V15");
const variant = (src, res, claim) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ia-v15v-")), "IA_SAVE.json");
  fs.writeFileSync(f, fs.readFileSync(src, "utf8").replace(/const RES_ENABLED = (true|false);/g, "const RES_ENABLED = " + res + ";")
    .replace(/const IA_CLAIM_ENABLED = (true|false);/g, "const IA_CLAIM_ENABLED = " + claim + ";"));
  return f;
};
const V14 = variant(SRC14, false, false);
const V15 = variant(SRC15, false, false);
const V14_CL = variant(SRC14, true, true);
const V15_CL = variant(SRC15, true, true);
const index = (doc) => {
  const out = {};
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.id === "string" && n.type) out[n.id] = n;
      Object.values(n).forEach(walk);
    }
  };
  walk(doc.nodes);
  return out;
};
const OLD = index(JSON.parse(fs.readFileSync(SRC14, "utf8")));
const NEW = index(JSON.parse(fs.readFileSync(SRC15, "utf8")));
const NEW_IDS = new Set(Object.keys(NEW).filter((x) => !OLD[x]));

const T = "000000";
const UID = "2109866916722085890";
const ORG = "1123598813738675201";
const PLANT = "1123598813738675202";
const IA = "2112073133161844738";
const PARENT = "2094626841323700251";
const COMP = "2094626841323700252";
const COMP2 = "2094626841323700253";
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
const LOT3 = "2113300000000000003";

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

// the guard's read of the IA's request, from the SQL text it sends (null = the column is NULL: the platform leaves it out)
const requestRead = (text, sc) => {
  const q = String(text || "").replace(/\s+/g, " ");
  if (!/\bAS iatr\b/.test(q)) return null;
  const gate = /IF\('(\w*)' = 'YES' OR h\.item_assembly_status <> 'Draft', \(SELECT/.exec(q);
  if (!gate) throw new Error("the request read without its gate: " + q.slice(0, 400));
  sc.gates.push(gate[1]);
  if (!(gate[1] === "YES" || (sc.stored !== null && sc.stored !== undefined && sc.stored !== "Draft"))) return null;
  if (sc.iatrText !== undefined) return sc.iatrText;
  const ten = (/rq\.tenant_id = '(\w*)'/.exec(q) || [])[1];
  const ia = (/rq\.source_ia_id = '(\w*)'/.exec(q) || [])[1];
  // a predicate missing from the text filters nothing (as MySQL would read it)
  let rows = (sc.requests || []).filter((r) => (ten === undefined || r.tenant === ten) && (ia === undefined || r.source === ia));
  if (/rq\.is_deleted = 0/.test(q)) rows = rows.filter((r) => !r.deleted);
  if (/rq\.transfer_purpose = 'IA_SUPPLY'/.test(q)) rows = rows.filter((r) => r.purpose === "IA_SUPPLY");
  if (/COALESCE\(rq\.stock_movement_status, ''\) <> 'Cancelled'/.test(q)) rows = rows.filter((r) => r.status !== "Cancelled");
  const desc = /ORDER BY rq\.id DESC LIMIT 1\)/.test(q);
  rows.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1) * (desc ? -1 : 1));
  const r = rows[0];
  if (!r) return null;
  const lines = r.lines.filter((l) => !(l.deleted && /rl\.is_deleted = 0/.test(q)) && /rl\.sm_location_transfer_id = rq\.id/.test(q));
  const byId = lines.slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const first = /MIN\(rl\.id\) AS first_id/.test(q) ? byId[0] : byId[byId.length - 1];
  const bin = first ? first.loc : null;
  const obj = { id: r.id, no: r.no, bin: bin, lines: lines.length ? lines.map((l) => l.src) : null, status: r.status === undefined ? null : r.status,
    bin_name: bin ? (sc.binNames || {})[bin] || null : null };
  const text2 = JSON.stringify(obj);
  return sc.bare ? text2.replace(/"(\d{16,})"/g, "$1") : text2;
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
            const iatr = requestRead(text, sc);
            return [Object.assign({ ia_id: IA, item_assembly_status: sc.stored }, /h\.stock_movement_no\b/.test(String(text || "")) ? { stock_movement_no: "IA-0009" } : {},
              iatr === null ? {} : { iatr: iatr })];
          },
          sql_node_RESown: () => [{ j: JSON.stringify({ rows: null, live: 0 }) }],
          sql_node_IAclaimState: () => {
            const mine = sc.steps.filter((x) => x.job_id === "IAS|" + IA && /^CLAIM\|/.test(x.step_name));
            return [{ j: JSON.stringify({ max: mine.reduce((m, x) => Math.max(m, Number(x.step_name.slice(6))), 0), now: "2026-10-28 14:00:00" }) }];
          },
          sql_node_IAclaims: () => {
            const held = sc.steps.filter((x) => x.job_id === "IAS|" + IA && /^CLAIM\|/.test(x.step_name) && x.step_status === "HELD" && !Number(x.is_deleted));
            return [{ j: JSON.stringify({ claims: held.length ? held.map((x) => ({ id: x.id, name: x.step_name, started_at: x.started_at })) : null, status: sc.stored,
              now: "2026-10-28 14:00:00" }) }];
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
    // the platform: an sql-node whose response_json lists columns keeps only those (a NULL column is left out by the mock)
    if (nd.type === "sql-node") {
      const names = (d.response_json || []).map((r) => r.name).filter((x) => x);
      const rows = ctx.out[nd.id];
      if (names.length && Array.isArray(rows)) ctx.out[nd.id] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => names.indexOf(k) >= 0)));
    }
  }
}

const pk = (loc, qty) => ({ material_id: COMP, location_id: loc, batch_id: null, balance_id: "9000", sm_quantity: qty === undefined ? 1 : qty, category: "Unrestricted" });
const lineOf = (id, comp, name, picks, extra) => Object.assign({ item_selection: comp, item_name: name, total_quantity: picks.reduce((s, p) => s + p.sm_quantity, 0),
  requested_qty: 1, quantity_uom: UOM, temp_qty_data: JSON.stringify(picks), temp_hu_data: "", line_index: 1 }, id ? { id: id } : {}, extra || {});
const record = (page, lines, extra) => Object.assign({
  organization_id: ORG, issuing_operation_faci: PLANT, stock_movement_no: "", stock_movement_no_type: "2098266711093927937",
  item_assembly_status: page === "Add" ? "" : "Draft", item_id: PARENT, item_name: "TES500", item_desc: "", item_qty: 1, item_uom: UOM, item_assembly_date: "2026-10-28",
  issued_by: "sim", project_id: "", batch_no: "", storage_location_id: SL, location_id: BIN, inventory_category: "Unrestricted",
  remarks: "r1", remarks_2: "", remarks_3: "", reference_documents: [], page_status: page, output_split: [], stock_movement: lines,
}, page === "Add" ? {} : { id: IA }, extra || {});
const two = (loc1, loc2) => [lineOf(LINE1, COMP, "TES501", [pk(loc1, 2)]), lineOf(LINE2, COMP2, "TES502", [pk(loc2, 1)])];
const item = (extra) => Object.assign({ id: PARENT, material_code: "TES500", stock_control: 1, item_batch_management: 0, batch_number_genaration: "", assembly_cost: 0,
  serial_number_management: 0, based_uom: UOM, table_uom_conversion: [{ alt_uom_id: UOM, base_qty: 1 }] }, extra || {});
const ITEMS = [item(), { id: COMP, material_code: "TES501", stock_control: 1, item_batch_management: 0, batch_number_genaration: "" },
  { id: COMP2, material_code: "TES502", stock_control: 1, item_batch_management: 0, batch_number_genaration: "" }];
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
const sameAsV14 = (label, sc, files, guardRan) => {
  const [a14, a15] = files || [V14, V15];
  const a = go(a14, JSON.parse(JSON.stringify(sc)));
  const b = go(a15, JSON.parse(JSON.stringify(sc)));
  eq(label + ": answer == v14", b.returned, a.returned);
  eq(label + ": steps minus the guard's new nodes == v14", b.steps.filter((s) => !NEW_IDS.has(s)), a.steps);
  // the new if is evaluated on every Edit save that passes the guard; taken only for a received request (its code node, its 400 if)
  const added = b.steps.filter((s) => NEW_IDS.has(s));
  if (guardRan) eq(label + ": the guard's picks check ran", added, ["if_IAtrPicks", "code_node_IAtrPicks", "if_IAtrPicks400"]);
  else eq(label + ": no new node ran (at most if_IAtrPicks, not taken)", added.filter((s) => s !== "if_IAtrPicks"), []);
  eq(label + ": writes == v14", stamp(b.writes), stamp(a.writes));
  eq(label + ": callee calls == v14", b.calls, a.calls);
  return b;
};
const refused = (label, res, re) => {
  eq(label + ": 400", res.returned && res.returned.code, "400");
  yes(label + ": its message (" + ((res.returned && res.returned.message) || JSON.stringify(res.returned)) + ")", re.test((res.returned && res.returned.message) || ""));
  eq(label + ": nothing written, no callee (no stock call)", [res.writes.length, res.calls.length], [0, 0]);
  yes(label + ": refused in the guard, before code_fillback", res.steps.indexOf("code_fillback") < 0);
};
const named = (res, wf) => res.calls.filter((c) => c[0] === wf).map((c) => c[1]);
const LIVE_RE = (no, st) => new RegExp("^The materials of this Item Assembly are still being transferred \\(transfer request " + no + " is " + st + "\\): receive it first, or cancel it\\.$");
const edit = (saveAs, lines, extra, sc) => Object.assign({ stored: "Draft", saveAs: saveAs, pageStatus: "Edit", allData: record("Edit", lines, extra) }, sc || {});

// ---- the declared shapes (the platform keeps only declared keys, converted to their declared type)
{
  const rj = (id) => NEW[id].data.response_json.map((r) => [r.name, r.bsonType]);
  eq("declared: the read's iatr column (string)", rj("sql_node_IAguard").slice(-1), [["iatr", "string"]]);
  eq("declared: the guard input's outcome keys (strings)", rj("code_node_IAguardIn").slice(-3), [["trDraft", "string"], ["trTarget", "string"], ["trRead", "string"]]);
  eq("declared: iatrPicks (string)", rj("code_node_IAguardStored").slice(-1), [["iatrPicks", "string"]]);
  eq("declared: the picks node's route / message (strings)", rj("code_node_IAtrPicks"), [["route", "string"], ["message", "string"]]);
  eq("the new nodes", [...NEW_IDS].sort(), ["code_node_IAtrPicks", "if_IAtrPicks", "if_IAtrPicks400", "if_IAtrPicks400_f", "if_IAtrPicks400_t", "if_IAtrPicks_f", "if_IAtrPicks_t",
    "return_node_IAtr400"]);
}

// ================================================================ no request: v14 save for save
let r = sameAsV14("Add, Completed (no stored read)", { stored: "Draft", saveAs: "Completed", pageStatus: "Add", allData: record("Add", two(WH, WH)) });
eq("Add: completed, no guard read", [r.returned.code, r.reads.length], ["200", 0]);
r = sameAsV14("Edit, stored Draft, Completed", edit("Completed", two(WH, WH)));
eq("Edit Completed: the read's gate YES (no request)", [r.returned.code, r.gates], ["200", ["YES"]]);
r = sameAsV14("Edit, stored Draft, Draft", edit("Draft", two(WH, WH)));
eq("Edit Draft of a stored Draft: the gate NO (the request never read)", r.gates, ["NO"]);
r = sameAsV14("Edit, stored Draft, Created (the Draft path)", edit("Draft", two(WH, WH), { ia_target_status: "Created" }));
eq("Created: the gate YES", r.gates, ["YES"]);
r = sameAsV14("Edit, stored Created, Draft path (stays Created)", edit("Draft", two(WH, WH), { item_assembly_status: "Created" }, { stored: "Created" }));
eq("stored Created, Draft path: the gate NO, the read itself opens it (stored not Draft)", r.gates, ["NO"]);
r = sameAsV14("Clone, Draft", { stored: "Completed", saveAs: "Draft", pageStatus: "Clone", allData: record("Clone", two(WH, WH), { id: IA, item_assembly_status: "Completed" }) });
r = sameAsV14("Edit, Completed, claim + holds ON", edit("Completed", two(WH, WH)), [V14_CL, V15_CL]);
r = sameAsV14("Edit, Completed, the receipt refused (400)", edit("Completed", two(WH, WH), {}, { addAnswers: [{ code: "400", errorMessage: "no bin" }] }));
eq("receipt refused: v14's answer", [r.returned.code, r.returned.message], ["400", "no bin"]);
r = sameAsV14("Edit, stored Processing (the busy guard)", edit("Completed", two(WH, WH), {}, { stored: "Processing" }));
r = sameAsV14("Edit, stored Completed saved as Draft (409)", edit("Draft", two(WH, WH), { item_assembly_status: "Completed" }, { stored: "Completed" }));
// ---- only a Cancelled request / another IA's / not IA_SUPPLY / deleted: v14
const others = [req(LOT1, "LOT-R1", "Cancelled"), req(LOT2, "LOT-R2", "Requested", null, { source: "2112073133161844799" }),
  req(LOT3, "LOT-R3", "Requested", null, { purpose: "" }), req("2113300000000000004", "LOT-R4", "Requested", null, { deleted: true }),
  req("2113300000000000005", "LOT-R5", "Requested", null, { tenant: "000001" })];
r = sameAsV14("Completed, only a Cancelled request + other IAs' / tenants' / purposes' / deleted ones", edit("Completed", two(WH, WH), {}, { requests: others }));
eq("only Cancelled: completed (picks anywhere)", r.returned.code, "200");
r = sameAsV14("Created, only a Cancelled request", edit("Draft", two(WH, WH), { ia_target_status: "Created" }, { requests: [req(LOT1, "LOT-R1", "Cancelled")] }));
// ---- a Draft save with a live request: v14 (never read)
for (const st of ["Requested", "In Progress", "Processing"]) {
  r = sameAsV14("Draft with a request " + st, edit("Draft", two(WH, WH), {}, { requests: [req(LOT1, "LOT-R1", st)] }));
  eq("Draft with a request " + st + ": saved", r.returned.code, "200");
}
// defense in depth: a Draft outcome is never refused here, even when the read opens (a stored status the IA never has)
r = sameAsV14("a Draft save of an IA stored 'Pending' (the read opens), a live request: v14", edit("Draft", two(WH, WH), { item_assembly_status: "Pending" },
  { stored: "Pending", requests: [req(LOT1, "LOT-R1", "Requested")] }));
eq("stored 'Pending', Draft path: the read ran (gate NO, the stored status opened it), saved as Draft", [r.returned.code, r.gates], ["200", ["NO"]]);
r = sameAsV14("a Draft save of a stored Completed IA with a live request: v14's 409", edit("Draft", two(WH, WH), { item_assembly_status: "Completed" },
  { stored: "Completed", requests: [req(LOT1, "LOT-R1", "Requested")] }));
eq("stored Completed, Draft: v14's 409", r.returned.code, "409");

// ================================================================ a live request: Created / Completed refused before anything
for (const st of ["Requested", "In Progress", "Processing"]) {
  r = go(V15, edit("Draft", two(BIN, WH), { ia_target_status: "Created" }, { requests: [req(LOT1, "LOT-R1", st)] }));
  refused("Created while " + st, r, LIVE_RE("LOT-R1", st));
  r = go(V15, edit("Completed", two(BIN, BIN), {}, { requests: [req(LOT1, "LOT-R1", st)] }));
  refused("Completed while " + st, r, LIVE_RE("LOT-R1", st));
}
r = go(V15, edit("Completed", two(BIN, BIN), { item_assembly_status: "Created" }, { stored: "Created", requests: [req(LOT1, "LOT-R1", "In Progress")] }));
refused("a stored Created completed while In Progress", r, LIVE_RE("LOT-R1", "In Progress"));
r = go(V15, edit("Draft", two(BIN, BIN), { item_assembly_status: "Created" }, { stored: "Created", requests: [req(LOT1, "LOT-R1", "Requested")] }));
refused("a stored Created saved on the Draft path (it stays Created) while Requested", r, LIVE_RE("LOT-R1", "Requested"));
r = go(V15_CL, edit("Completed", two(BIN, BIN), {}, { requests: [req(LOT1, "LOT-R1", "Requested")] }));
refused("claim + holds ON: refused before the claim", r, LIVE_RE("LOT-R1", "Requested"));
r = go(V15, edit(" Draft", two(BIN, BIN), {}, { requests: [req(LOT1, "LOT-R1", "Requested")] }));
refused("a padded saveAs (' Draft': if_validate completes it) is a completion", r, LIVE_RE("LOT-R1", "Requested"));
r = go(V15, edit("Completed", two(BIN, BIN), {}, { requests: [req(LOT1, "LOT-R1", "Completed"), req(LOT2, "LOT-R2", "Requested"), req(LOT3, "LOT-R3", "Cancelled")] }));
refused("the latest request that is not Cancelled decides (an older received one, a newer Cancelled one)", r, LIVE_RE("LOT-R2", "Requested"));
r = go(V15, edit("Completed", two(BIN, BIN), {}, { requests: [req(LOT1, "", "Requested")] }));
refused("a request without a number: named by its id", r, LIVE_RE(LOT1, "Requested"));
r = go(V15, edit("Completed", two(BIN, BIN), {}, { requests: [req(LOT1, "LOT-R1", "Draft")] }));
refused("a status the guard does not know: refused (fail closed)", r, LIVE_RE("LOT-R1", "Draft"));
r = go(V15, edit("Completed", two(BIN, BIN), {}, { requests: [req(LOT1, "LOT-R1", undefined)] }));
refused("a request without a status: refused", r, LIVE_RE("LOT-R1", "without a status"));
r = go(V15, edit("Completed", two(BIN, BIN), {}, { iatrText: "{truncated" }));
refused("an unreadable request: refused", r, /^The transfer request of this Item Assembly could not be read/);
r = go(V15, edit("Draft", two(WH, WH), { item_assembly_status: "Created" }, { stored: "Created", iatrText: "{truncated" }));
refused("an unreadable request, a stored Created kept Created: refused", r, /^The transfer request of this Item Assembly could not be read/);
r = sameAsV14("an unreadable request, a Draft save of a stored Draft: never read, v14", edit("Draft", two(WH, WH), {}, { iatrText: "{truncated" }), null, false);
// the existing guards keep their order: busy, cancelled, final-as-Draft, too many picks
r = go(V15, edit("Completed", two(BIN, BIN), {}, { stored: "Processing", requests: [req(LOT1, "LOT-R1", "Requested")] }));
eq("stored Processing + a live request: the busy answer", [r.returned.code, /background/.test(r.returned.message)], ["400", true]);
r = go(V15, edit("Completed", two(BIN, BIN), {}, { stored: "Cancelled", requests: [req(LOT1, "LOT-R1", "Requested")] }));
eq("stored Cancelled + a live request: the 409 cancelled answer", [r.returned.code, /cancelled/.test(r.returned.message)], ["409", true]);
r = go(V15, edit("Completed", [lineOf(LINE1, COMP, "TES501", Array.from({ length: 251 }, () => pk(BIN, 1)))], {}, { requests: [req(LOT1, "LOT-R1", "Requested")] }));
eq("251 picks + a live request: the too-many-picks answer", [r.returned.code, /251 stock picks/.test(r.returned.message), r.writes.length], ["400", true, 0]);

// ================================================================ a received request: its lines' picks at its destination bin
const RECEIVED = () => [req(LOT1, "LOT-R1", "Completed", [{ id: "2113300000000000011", src: LINE1, loc: BIN }])];
const PICK_RE = (nLine, item, bin, no) => new RegExp("^Line " + nLine + " \\(" + item + "\\): pick it from " + bin + ", where transfer request " + no + " delivered it\\.$");
r = go(V15, edit("Completed", two(WH, WH), {}, { requests: RECEIVED() }));
refused("received, its line picked in the warehouse: Completed", r, PICK_RE(1, "TES501", "PROD-A1", "LOT-R1"));
r = go(V15, edit("Draft", two(WH, WH), { ia_target_status: "Created" }, { requests: RECEIVED() }));
refused("received, its line picked in the warehouse: Created", r, PICK_RE(1, "TES501", "PROD-A1", "LOT-R1"));
r = go(V15, edit("Completed", [lineOf(LINE1, COMP, "TES501", [pk(BIN, 1), pk(WH, 1)]), lineOf(LINE2, COMP2, "TES502", [pk(WH, 1)])], {}, { requests: RECEIVED() }));
refused("received, one of its line's picks elsewhere", r, PICK_RE(1, "TES501", "PROD-A1", "LOT-R1"));
r = go(V15, edit("Completed", [lineOf(LINE2, COMP2, "TES502", [pk(WH, 1)]), lineOf(LINE1, COMP, "TES501", [pk(WH, 2)], { line_index: 7 })], {}, { requests: RECEIVED() }));
refused("received: Line n is the line's position (the line_index code_fillback writes)", r, PICK_RE(2, "TES501", "PROD-A1", "LOT-R1"));
r = sameAsV14("received, picks at the destination: completes as v14", edit("Completed", two(BIN, WH), {}, { requests: RECEIVED() }), null, true);
eq("received + at the destination: completed, its picks issued from the destination", [r.returned.code, named(r, "SUBTRACT_INVENTORY").map((p) => p.location_id)], ["200", [BIN, WH]]);
r = sameAsV14("received, picks at the destination: Created as v14", edit("Draft", two(BIN, WH), { ia_target_status: "Created" }, { requests: RECEIVED() }), null, true);
r = sameAsV14("received + claim ON: completes as v14", edit("Completed", two(BIN, WH), {}, { requests: RECEIVED() }), [V14_CL, V15_CL], true);
r = sameAsV14("received, a line it did not supply (LINE2) picked anywhere", edit("Completed", two(BIN, NEIGHBOUR), {}, { requests: RECEIVED() }), null, true);
r = sameAsV14("received, a Draft save with picks elsewhere: v14", edit("Draft", two(WH, WH), {}, { stored: "Draft", requests: RECEIVED() }), null, false);
r = sameAsV14("received, its line with a zero pick elsewhere", edit("Completed", [lineOf(LINE1, COMP, "TES501", [pk(BIN, 1), pk(WH, 0)]), lineOf(LINE2, COMP2, "TES502", [pk(WH, 1)])], {},
  { requests: RECEIVED() }), null, true);
r = sameAsV14("an IA already Completed, completed again with a received request + picks elsewhere: v14's own answer",
  edit("Completed", two(WH, WH), { item_assembly_status: "Completed" }, { stored: "Completed", requests: RECEIVED() }), null, false);
r = go(V15, edit("Completed", two(NEIGHBOUR, WH), {}, { requests: RECEIVED(), bare: true }));
refused("bare 19-digit numbers in the read: the neighbouring bin is not the destination", r, PICK_RE(1, "TES501", "PROD-A1", "LOT-R1"));
r = sameAsV14("bare 19-digit numbers in the read: the destination itself passes", edit("Completed", two(BIN, WH), {}, { requests: RECEIVED(), bare: true }), null, true);
// the destination = the request's first line's bin (by id), its name from the bin
r = go(V15, edit("Completed", [lineOf(LINE1, COMP, "TES501", [pk(NEIGHBOUR, 1)]), lineOf(LINE2, COMP2, "TES502", [pk(NEIGHBOUR, 1)])], {},
  { requests: [req(LOT1, "LOT-R1", "Completed", [{ id: "2113300000000000012", src: LINE2, loc: NEIGHBOUR }, { id: "2113300000000000011", src: LINE1, loc: BIN }])] }));
refused("the destination is the first line's bin (by id), not the last", r, PICK_RE(1, "TES501", "PROD-A1", "LOT-R1"));
r = go(V15, edit("Completed", two(WH, WH), {}, { requests: RECEIVED(), binNames: {} }));
refused("a bin without a name: named by its id", r, PICK_RE(1, "TES501", BIN, "LOT-R1"));
r = go(V15, edit("Completed", two(WH, WH), {}, { requests: [req(LOT1, "LOT-R1", "Completed", [{ id: "2113300000000000011", src: LINE1, loc: BIN, deleted: true },
  { id: "2113300000000000013", src: LINE2, loc: BIN }])] }));
refused("a deleted request line is not the request's (LINE1 free, LINE2 checked)", r, PICK_RE(2, "TES502", "PROD-A1", "LOT-R1"));

console.log((fails ? "FAILED " : "ok - ") + (n - fails) + "/" + n + " checks");
process.exit(fails ? 1 : 0);
