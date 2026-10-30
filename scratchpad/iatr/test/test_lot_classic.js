// SM_LOCATION_TRANSFER v86 (scratchpad/iatr/classic/patch_lot_classic.py) against the deployed v85 (base/SM_LOCATION_TRANSFER.v85.json):
//  1. structure: v86 minus its 5 new nodes, with its 4 exact changes reverted, is v85 node for node;
//  2. runs (scratchpad/iav2/lib/sim engine): every ordinary path gives v85's calls and writes; Save Picks keeps a request Requested and
//     moves nothing; every refused request move answers 400 before any write or call.
//   node scratchpad/iatr/test/test_lot_classic.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IATR = path.join(__dirname, "..");
const REPO = path.join(IATR, "..", "..");
const { Engine } = require(path.join(REPO, "scratchpad", "iav2", "lib", "sim", "engine.js"));

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

const OUT = process.env.IATR_CLASSIC || (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-classic-"));
  const b = spawnSync("python3", [path.join(IATR, "classic", "patch_lot_classic.py"), "--write"], { env: Object.assign({}, process.env, { IATR_OUT: dir }), encoding: "utf8" });
  if (b.status !== 0) throw new Error("build failed: " + b.stderr.slice(-800));
  return path.join(dir, "SM_LOCATION_TRANSFER.json");
})();
const V86 = JSON.parse(fs.readFileSync(OUT, "utf8"));
const V85 = JSON.parse(fs.readFileSync(path.join(IATR, "base", "SM_LOCATION_TRANSFER.v85.json"), "utf8"));

// ================================================================ 1. structure
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);
const NEW = ["code_node_LOTrq", "if_LOTrqRefuse"];
const index = (doc) => {
  const out = {};
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      if (typeof x.id === "string" && x.type) out[x.id] = x;
      Object.values(x).forEach(walk);
    }
  };
  walk(doc.nodes);
  return out;
};
{
  const u = JSON.parse(JSON.stringify(V86));
  u.nodes = u.nodes.filter((x) => NEW.indexOf(x.id) < 0);
  const at = index(u);
  const sq = at.sql_node_LOTguard.data;
  sq.script.code = sq.script.code.replace(/SELECT g\.stock_movement_status,\n       g\.transfer_purpose,\n       CASE WHEN [^\n]*\n[^\n]* END AS line_ids,\n/, "SELECT g.stock_movement_status,\n");
  sq.response_json = sq.response_json.filter((r) => r.name !== "transfer_purpose" && r.name !== "line_ids");
  const y = at.code_node_yPlLXIZW.data;
  y.script.code = y.script.code.replace(/\/\/ IA transfer request \(scratchpad\/iatr\): Save Picks[^\n]*\nconst writeStatus = [^\n]*\n/, "").replace("  writeStatus: writeStatus,\n", "");
  y.response_json = y.response_json.filter((r) => r.name !== "writeStatus");
  at.update_node_WKLUE7ka.data.props.list.filter((p) => p.prop === "stock_movement_status").forEach((p) => (p.value = "{{workflowparams:saveAs}}"));
  eq("structure: v86 minus the request nodes, its 4 exact changes reverted == v85 (nodes, edges, request / response, config)", JSON.stringify(canon(u)) === JSON.stringify(canon(V85)), true);
  const top = V86.nodes.map((x) => x.id);
  eq("structure: the request decision right after the v85 guard, before the classic's first node", top.slice(1, 7),
    ["code_node_LOTguard", "if_LOTguardRead", "if_LOTguardBigNew", "code_node_LOTrq", "if_LOTrqRefuse", "if_UCLsQLO6"]);
  eq("structure: the guard reads a request's stored line ids only (an ordinary LOT gets NULL, the subquery never runs)",
    index(V86).sql_node_LOTguard.data.script.code.split("\n").slice(2, 4),
    ["       CASE WHEN g.transfer_purpose = 'IA_SUPPLY' THEN (SELECT JSON_ARRAYAGG(CAST(r.id AS CHAR)) FROM sm_location_transfer_d2c7o1jd_sub r",
      "         WHERE r.tenant_id = '{{node:code_node_LOTguard.data.tenantId}}' AND r.sm_location_transfer_id = g.id AND r.is_deleted = 0) END AS line_ids,"]);
  const w = index(V86).update_node_WKLUE7ka.data.props.list.filter((p) => p.prop === "stock_movement_status");
  eq("structure: the Draft update writes writeStatus", w.map((p) => p.value), ["{{node:code_node_yPlLXIZW.data.writeStatus}}"]);
  const others = Object.values(index(V86)).filter((x) => x.type === "add-node" || x.type === "update-node").map((x) => [x.id, ((x.data.props || {}).list || [])
    .filter((p) => p.prop === "stock_movement_status").map((p) => p.value)]).filter((x) => x[1].length && x[0] !== "update_node_WKLUE7ka");
  yes("structure: every other status write still takes saveAs", others.length > 0 && others.every((x) => same(x[1], ["{{workflowparams:saveAs}}"])));
}

// ================================================================ 2. runs
const T = "711077";
const LOT = "2120000000000000001";
const pick = (qty, o) => Object.assign({ material_id: "M1", location_id: "BIN1", batch_id: null, category: "Unrestricted", material_uom: "77", sm_quantity: qty, balance_id: "BL1" }, o || {});
const line = (id, o) => Object.assign({ id: id, fm_key: "k" + id, line_index: "1", item_selection: "M1", item_name: "RM-1", quantity_uom: "77", requested_qty: 10, total_quantity: 10,
  location_id: "BIN9", storage_location_id: "S1", temp_qty_data: JSON.stringify([pick(10)]), source_ia_line_id: "IAL1" }, o || {});
const doc = (o) => Object.assign({ id: LOT, page_status: "Edit", stock_movement_status: "Requested", transfer_purpose: "IA_SUPPLY", issuing_operation_faci: "P1",
  organization_id: "O1", stock_movement_no: "LOT-20261028/0001", stock_movement_no_type: "2105200574229549070", issue_date: "2026-10-28 00:00:00", movement_type: "Location Transfer",
  movement_type_id: "MT1", movement_reason: "", stock_movement: [line("L1")] }, o || {});

class Sim extends Engine {
  constructor(wf, sc) {
    const writes = [];
    const calls = [];
    const db = {
      tenantId: T,
      uid: "2105190590557097986",
      insert: (table, rows) => rows.map((r0, i) => {
        const r = Object.assign({}, r0, { id: String(3000000000000000001n + BigInt(writes.length + i)) });
        writes.push(["insert", table, r]);
        return r;
      }),
      update: (table, rows) => {
        rows.forEach((r) => writes.push(["update", table, r]));
        return { count: rows.length };
      },
    };
    super({
      dir: os.tmpdir(), db,
      mocks: {
        sql: {
          // line_ids: the CASE gives a request's stored line ids as JSON text, NULL for an ordinary LOT
          sql_node_LOTguard: () => (sc.stored === null ? [] : [{ stock_movement_status: sc.stored, transfer_purpose: sc.purpose === undefined ? "IA_SUPPLY" : sc.purpose, line_count: 1,
            line_ids: sc.lineIds !== undefined ? sc.lineIds : sc.purpose === undefined || sc.purpose === "IA_SUPPLY" ? JSON.stringify(["L1"]) : null }]),
        },
        read: Object.assign({}, sc.reads || {}),
      },
    });
    this.wf = wf;
    this.sc = sc;
    this.writes = writes;
    this.calls = calls;
  }

  load(name) {
    if (name === "SM_LOCATION_TRANSFER") return this.wf;
    throw new Error("no workflow " + name);
  }

  run(name, params) {
    if (name !== "SM_LOCATION_TRANSFER") {
      this.calls.push([name, JSON.parse(JSON.stringify(params))]);
      return { returned: (this.sc.answers || {})[name] || { code: "200", message: "ok" }, ctx: null };
    }
    return super.run(name, params);
  }

  injectJs(text, ctx) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, ref) => {
      const v = this.resolve(ref, ctx);
      return v === undefined ? "null" : JSON.stringify(v);
    });
  }

  cond(list, ctx) {
    const one = (x) => {
      if (x.type === "branch") {
        const kids = (x.children || []).map(one);
        return x.operator === "any" ? kids.some(Boolean) : kids.every(Boolean);
      }
      const v = this.resolve(x.prop.replace(/^(workflowparams|node)\./, "$1:"), ctx);
      if (x.operator === "equal") return String(v) === String(x.value);
      if (x.operator === "notEqual") return String(v) !== String(x.value);
      if (x.operator === "numberEqual") return Number(v) === Number(x.value);
      throw new Error("operator " + x.operator);
    };
    return (list || []).every(one);
  }

  node(nd, ctx) {
    const d = nd.data || {};
    if (nd.type === "if" && d.condition_type === "ConditionRule") {
      this.trace.push(ctx.name + " " + nd.id);
      return this.block(nd.blocks[this.cond(d.filter.list, ctx) ? 0 : 1].blocks, ctx);
    }
    return super.node(nd, ctx);
  }
}
const go = (wf, sc) => {
  const s = new Sim(wf, sc);
  let r;
  try {
    r = s.run("SM_LOCATION_TRANSFER", { allData: sc.allData, saveAs: sc.saveAs, pageStatus: sc.allData.page_status });
  } catch (e) {
    r = { returned: { crashed: String(e.message).slice(0, 400) } };
  }
  return { returned: r.returned, writes: s.writes, calls: s.calls, trace: s.trace.filter((t) => t.indexOf("SM_LOCATION_TRANSFER ") === 0).map((t) => t.slice(21)) };
};
const statusWrites = (r) => r.writes.filter((w) => w[1] === "Location Transfer" && "stock_movement_status" in w[2]).map((w) => w[2].stock_movement_status);
const refused = (label, sc, re) => {
  const r = go(V86, sc);
  eq(label + ": 400", r.returned && r.returned.code, "400");
  yes(label + ": its message (" + ((r.returned && r.returned.message) || JSON.stringify(r.returned)) + ")", re.test((r.returned && r.returned.message) || ""));
  eq(label + ": nothing written, no sub-workflow called", [r.writes.length, r.calls.length], [0, 0]);
};

// ---- Save Picks: a stored request saved as Draft keeps its status, moves nothing
{
  const r = go(V86, { stored: "Requested", saveAs: "Draft", allData: doc() });
  eq("Save Picks: no refusal", (r.returned || {}).code === "400" || !!(r.returned || {}).crashed, false);
  eq("Save Picks: the transfer stays Requested", statusWrites(r), ["Requested"]);
  eq("Save Picks: only the required-field check is called, as for any Draft save (no SUBTRACT / ADD / allocation)", r.calls.map((c) => c[0]), ["CHECK_REQUIRED_FIELD"]);
  eq("Save Picks: the number is not written", r.writes.filter((w) => "stock_movement_no" in w[2]).length, 0);
  const r2 = go(V86, { stored: "Requested", saveAs: "Draft", allData: doc({ stock_movement: [line("2120000000000000005")] }), lineIds: '["2120000000000000005"]' });
  eq("Save Picks: 19-digit stored ids read as text match the sent ones", statusWrites(r2), ["Requested"]);
  const r3 = go(V86, { stored: "Requested", saveAs: "Draft", allData: doc(), lineIds: ["L1"] });
  eq("Save Picks: stored ids handed over as an array match too", statusWrites(r3), ["Requested"]);
}
refused("Save Picks from a tab opened before a refresh (the stored lines were replaced)", { stored: "Requested", saveAs: "Draft", allData: doc(), lineIds: '["L7"]' }, /refreshed/);
refused("Save Picks with a line added", { stored: "Requested", saveAs: "Draft", allData: doc({ stock_movement: [line("L1"), line("", { fm_key: "kNew" })] }) }, /refreshed/);
refused("Save Picks with a child line added", { stored: "Requested", saveAs: "Draft", allData: doc({ stock_movement: [line("L1", { children: [line("", { fm_key: "kC" })] })] }) },
  /refreshed/);
refused("Save Picks with a line removed", { stored: "Requested", saveAs: "Draft", allData: doc(), lineIds: '["L1","L2"]' }, /refreshed/);
// ---- refusals (the classic never moves a request's stock)
refused("Dispatch via the classic (stored Requested + In Progress)", { stored: "Requested", saveAs: "In Progress", allData: doc() }, /web form/);
refused("Requested + Completed", { stored: "Requested", saveAs: "Completed", allData: doc() }, /dispatched first/);
refused("Requested + Cancelled", { stored: "Requested", saveAs: "Cancelled", allData: doc() }, /Cancel Request/);
refused("Receive via the classic (purpose In Progress + Completed, e.g. mobile)", { stored: "In Progress", saveAs: "Completed", allData: doc({ stock_movement_status: "In Progress" }) },
  /web form/);
refused("Edit a dispatched request", { stored: "In Progress", saveAs: "In Progress", allData: doc({ stock_movement_status: "In Progress" }) }, /can't be edited/);
refused("Cancel a dispatched request via the classic", { stored: "In Progress", saveAs: "Cancelled", allData: doc({ stock_movement_status: "In Progress" }) }, /web form/);
refused("A stored Requested without the purpose", { stored: "Requested", purpose: "", saveAs: "Draft", allData: doc({ transfer_purpose: "" }) }, /not an Item Assembly request/);
refused("An Add carrying the purpose", { stored: null, saveAs: "Draft", allData: doc({ id: "", page_status: "Add", stock_movement_status: "Draft" }) }, /only be created from an Item Assembly/);
refused("A Clone carrying Requested", { stored: null, saveAs: "In Progress", allData: doc({ id: "", page_status: "Clone", transfer_purpose: "" }) }, /only be created from an Item Assembly/);
refused("An ordinary stored Draft whose payload claims the purpose", { stored: "Draft", purpose: "", saveAs: "In Progress", allData: doc({ stock_movement_status: "Draft" }) },
  /only be created from an Item Assembly/);

// ---- ordinary transfers: v86 == v85 (answer, calls, writes, the nodes run minus the request's two)
const twin = (label, sc) => {
  const a = go(V85, JSON.parse(JSON.stringify(sc)));
  const b = go(V86, JSON.parse(JSON.stringify(sc)));
  eq(label + ": v86 answer == v85", b.returned, a.returned);
  eq(label + ": v86 calls == v85", b.calls, a.calls);
  // the Item date stamp is each run's clock (new Date()): equal up to that
  const clock = (w) => JSON.parse(JSON.stringify(w).replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, "<now>"));
  eq(label + ": v86 writes == v85", clock(b.writes), clock(a.writes));
  eq(label + ": v86 nodes run == v85 + the request decision", b.trace.filter((t) => ["code_node_LOTrq", "if_LOTrqRefuse"].indexOf(t) < 0), a.trace);
  return b;
};
const ord = (o) => doc(Object.assign({ transfer_purpose: "", stock_movement_status: "Draft" }, o || {}));
let r = twin("ordinary Edit Draft saved as Draft", { stored: "Draft", purpose: "", saveAs: "Draft", allData: ord() });
eq("ordinary Draft save: status Draft written (writeStatus = saveAs)", statusWrites(r), ["Draft"]);
r = twin("ordinary Add saved as Draft", { stored: null, purpose: "", saveAs: "Draft", allData: ord({ id: "", page_status: "Add", stock_movement_no: "" }) });

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
