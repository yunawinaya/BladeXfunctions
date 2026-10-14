// node replay.js <SUBTRACT|ADD> <fixtures.jsonl> [--show N]
// Runs every recorded SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW call through core.js with the rows that call read,
// and compares what the engine would write with what the call computed (its code-node outputs).
const fs = require("fs");
const { planBulk, q8 } = require("./core.js");

const [, , kind, file] = process.argv;
const showAt = process.argv.indexOf("--show");
const SHOW = showAt > 0 ? Number(process.argv[showAt + 1]) : 5;
const out = (n, path) => {
  let v = n;
  for (const p of path) v = v === undefined || v === null ? undefined : v[p];
  return v;
};
const node = (rec, id) => (rec.nodes[id] ? rec.nodes[id].data : undefined);
const rowsOf = (get) => {
  if (!get) return [];
  const d = get.data;
  if (Array.isArray(d)) return d;
  return d && Object.keys(d).length ? [d] : [];
};
const num = (v) => (v === null || v === undefined || v === "" ? 0 : q8(v));
const eq = (a, b) => Math.abs(num(a) - num(b)) < 1e-6;

const tally = {};
const examples = {};
const bump = (k, rec, detail) => {
  tally[k] = (tally[k] || 0) + 1;
  if (!examples[k]) examples[k] = [];
  if (examples[k].length < SHOW) examples[k].push({ id: rec.id, tenant: rec.tenant, detail });
};

function subtractCase(rec) {
  const p = rec.params;
  const tc = node(rec, "code_node_TC1cqaOy");
  const itemData = (tc && tc.itemData) || p.itemData || out(node(rec, "get_node_ZGsF9gxG"), ["data"]);
  if (!itemData) return bump("skip:no-item", rec);
  const balRows = rowsOf(node(rec, "get_node_uaq6Z1ej"));
  const batchRows = rowsOf(node(rec, "get_node_GjRiq3dT"));
  const fifoS = node(rec, "search_node_NCi8U4My");
  const waS = node(rec, "search_node_7bvv7f8g");
  if ((fifoS && fifoS.total > 0 && (!fifoS.data || fifoS.data.length === 0)) || (waS && waS.total > 0 && (!waS.data || waS.data.length === 0))) {
    return bump("skip:trace-cut", rec);
  }
  // rows the call read; ids/keys normalised the way the engine keys them
  const items = {};
  items[String(p.material_id)] = itemData;
  const fifo = ((fifoS && fifoS.data) || []).map((r) => Object.assign({}, r, { material_id: p.material_id, plant_id: p.plant_id, organization_id: p.organization_id, batch_id: p.batch_id || null }));
  const wa = ((waS && waS.data) || []).map((r) => Object.assign({}, r, { material_id: p.material_id, plant_id: p.plant_id, organization_id: p.organization_id, batch_id: p.batch_id || null }));
  const keyed = (rows, extra) => rows.map((r) => Object.assign({}, r, { material_id: p.material_id, location_id: p.location_id, plant_id: p.plant_id, organization_id: p.organization_id }, extra || {}));
  const plan = planBulk({
    operationKey: "R",
    items,
    itemBalances: keyed(balRows),
    batchBalances: p.batch_id ? keyed(batchRows, { batch_id: p.batch_id }) : [],
    fifoLayers: fifo,
    waRows: wa,
    movements: [Object.assign({}, p, { movement_key: "m", direction: "SUBTRACT" })],
  });

  const migrated = rec.nodes.code_node_YqMfJIMz || rec.nodes.code_node_oz7GGSQA;
  const exit = rec.exit;
  if (rec.status !== "Complete") {
    if (!plan.ok) return bump("ok:fail-matches-failed-run(" + plan.failure.code + ")", rec);
    return bump("DIFF:run-failed-engine-ok", rec, { exit, status: rec.status });
  }
  if (migrated) return bump(plan.ok ? "DIFF:migration-not-refused" : "ok:migration-refused", rec);
  const expectFail = { return_node_UeAJPOPd: "INSUFFICIENT", return_node_Fj0eE8ac: "BALANCE_NOT_FOUND", return_node_rfb2MFbP: "VALIDATION_FAILED" }[exit];
  if (expectFail) {
    if (!plan.ok && plan.failure.code === expectFail) return bump("ok:" + expectFail, rec);
    return bump("DIFF:expected-" + expectFail, rec, plan.ok ? "engine ok" : plan.failure);
  }
  if (exit === "return_node_50mzzw0X") return bump(plan.ok && plan.results[0].code === "401" ? "ok:stock-control-0" : "DIFF:401", rec);
  if (!plan.ok) return bump("DIFF:engine-failed-run-ok", rec, plan.failure);

  const calc = node(rec, "code_node_mQnskse9");
  const r = plan.results[0];
  const diffs = [];
  if (!eq(r.unit_price, calc.calculatedUnitPrice)) diffs.push(["unit_price", r.unit_price, calc.calculatedUnitPrice]);
  if (!eq(r.total_price, calc.totalPrice)) diffs.push(["total_price", r.total_price, calc.totalPrice]);
  const ib = plan.updates.item_balance[0];
  const map = { unrestricted_qty: "unrestrictedQty", reserved_qty: "reservedQty", block_qty: "blockedQty", qualityinsp_qty: "qualityInspectionQty", intransit_qty: "inTransitQty", balance_quantity: "balanceQty" };
  if (balRows.length) {
    for (const c of Object.keys(map)) if (!ib || !eq(ib.after[c], calc[map[c]])) diffs.push(["item." + c, ib && ib.after[c], calc[map[c]]]);
  }
  if (p.batch_id && batchRows.length) {
    const bb = plan.updates.item_batch_balance[0];
    const bmap = { unrestricted_qty: "batchUnrestrictedQty", reserved_qty: "batchReservedQty", block_qty: "batchBlockedQty", qualityinsp_qty: "batchQualityInspectionQty", intransit_qty: "batchInTransitQty", balance_quantity: "batchBalanceQty" };
    for (const c of Object.keys(bmap)) if (!bb || !eq(bb.after[c], calc[bmap[c]])) diffs.push(["batch." + c, bb && bb.after[c], calc[bmap[c]]]);
  }
  const fifoCalc = node(rec, "code_node_XLW4aVTn");
  if (fifoCalc) {
    const want = {};
    for (const u of fifoCalc.updates || []) want[String(u.id)] = u.fifo_available_quantity;
    const got = {};
    for (const u of plan.updates.fifo) got[u.id] = u.after.fifo_available_quantity;
    for (const id of new Set(Object.keys(want).concat(Object.keys(got)))) if (!eq(want[id], got[id]) || !(id in want) || !(id in got)) diffs.push(["fifo." + id, got[id], want[id]]);
  } else if (plan.updates.fifo.length) diffs.push(["fifo.unexpected", plan.updates.fifo.length, 0]);
  const waCalc = node(rec, "code_node_fVEv7HuP");
  if (waCalc) {
    const u = plan.updates.wa[0];
    if (!u || u.id !== String(waCalc.id) || !eq(u.after.wa_quantity, waCalc.wa_quantity)) diffs.push(["wa", u && [u.id, u.after.wa_quantity], [waCalc.id, waCalc.wa_quantity]]);
  } else if (plan.updates.wa.length) diffs.push(["wa.unexpected", plan.updates.wa.length, 0]);
  const uom = node(rec, "code_node_wBfvXM2G");
  if (uom && !eq(plan.movements[0].base_qty, uom.baseQty)) diffs.push(["base_qty", plan.movements[0].base_qty, uom.baseQty]);
  if (diffs.length) return bump("DIFF:values", rec, diffs);
  bump("ok:identical", rec);
}

function addCase(rec) {
  const p = rec.params;
  const tc = node(rec, "code_node_3XzQSsce");
  const itemData = (tc && tc.itemData) || p.itemData || out(node(rec, "get_node_MuNnpfmj"), ["data"]);
  if (!itemData) return bump("skip:no-item", rec);
  const balRows = rowsOf(node(rec, "get_node_dzqHveJM"));
  const batchRows = rowsOf(node(rec, "get_node_kePN6D3V"));
  const fifoS = node(rec, "search_node_lPUQktoS");
  const waS = node(rec, "search_node_EhZwGMYs");
  if ((fifoS && fifoS.total > 0 && (!fifoS.data || !fifoS.data.length)) || (waS && waS.total > 0 && (!waS.data || !waS.data.length))) return bump("skip:trace-cut", rec);
  const gm = node(rec, "code_node_GMSJTmJr");
  const batchId = gm ? gm.batchId : p.batch_id;
  const newBatch = !!(p.batch_number !== "-" && p.batch_number && !p.batch_id);
  const items = {};
  items[String(p.material_id)] = itemData;
  const keyed = (rows, extra) => rows.map((r) => Object.assign({}, r, { material_id: p.material_id, location_id: p.location_id, plant_id: p.plant_id, organization_id: p.organization_id }, extra || {}));
  const plan = planBulk({
    operationKey: "R",
    items,
    itemBalances: keyed(balRows),
    // a new batch's id is minted by the add-node; the engine names it new:batch:n - compare the rest
    batchBalances: batchId && !newBatch ? keyed(batchRows, { batch_id: batchId }) : [],
    fifoLayers: ((fifoS && fifoS.data) || []).map((r) => Object.assign({}, r, { material_id: p.material_id, plant_id: p.plant_id, organization_id: p.organization_id, batch_id: newBatch ? null : batchId || null })),
    waRows: ((waS && waS.data) || []).map((r) => Object.assign({}, r, { material_id: p.material_id, plant_id: p.plant_id, organization_id: p.organization_id })),
    movements: [Object.assign({}, p, { movement_key: "m", direction: "ADD" })],
  });
  if (rec.status !== "Complete") return bump(plan.ok ? "DIFF:run-failed-engine-ok" : "ok:fail-matches-failed-run", rec, { status: rec.status, exit: rec.exit });
  if (rec.exit === "return_node_8ZcSkz7f") return bump(!plan.ok && plan.failure.code === "VALIDATION_FAILED" ? "ok:VALIDATION_FAILED" : "DIFF:validation", rec);
  if (rec.exit === "return_node_EAFxgDzE") return bump(plan.ok && plan.results[0].code === "401" ? "ok:stock-control-0" : "DIFF:401", rec);
  if (!plan.ok) return bump("DIFF:engine-failed-run-ok", rec, plan.failure);
  const r = plan.results[0];
  const diffs = [];
  const pr = node(rec, "code_node_BzebhJnQ");
  if (pr && (!eq(r.unit_price, pr.unitPrice) || !eq(r.total_price, pr.totalPrice))) diffs.push(["price", [r.unit_price, r.total_price], [pr.unitPrice, pr.totalPrice]]);
  const fin = node(rec, "code_node_fhf8Pn2f");
  const cols = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
  if (fin) {
    const u = plan.updates.item_balance[0];
    for (const c of cols) if (!u || !eq(u.after[c], fin[c])) diffs.push(["item." + c, u && u.after[c], fin[c]]);
  } else if (!balRows.length) {
    const c0 = plan.creates.item_balance[0];
    const bd = node(rec, "code_node_aFO7peip");
    if (bd) for (const c of cols) if (!c0 || !eq(c0[c], bd[c])) diffs.push(["newitem." + c, c0 && c0[c], bd[c]]);
  }
  const bfin = node(rec, "code_node_IohK2kdK");
  if (bfin && !newBatch) {
    const u = plan.updates.item_batch_balance[0];
    for (const c of cols.concat(["remark", "remark2", "remark3"])) {
      const a = u && u.after[c];
      const b = bfin[c];
      const same = c.indexOf("remark") === 0 ? String(a == null ? "" : a) === String(b == null ? "" : b) : eq(a, b);
      if (!same) diffs.push(["batch." + c, a, b]);
    }
  }
  const sq = node(rec, "code_node_wFHVEysj");
  if (sq) {
    const f = plan.creates.fifo[0];
    if (!f || Number(f.fifo_sequence) !== Number(sq.sequenceNumber)) diffs.push(["fifo.sequence", f && f.fifo_sequence, sq.sequenceNumber]);
  }
  const wc = node(rec, "code_node_BmARJUfl");
  if (wc) {
    const u = plan.updates.wa[0];
    if (!u || u.id !== String(wc.latestWaId) || !eq(u.after.wa_quantity, wc.newWaQuantity) || !eq(u.after.wa_cost_price, wc.newWaCostPrice)) diffs.push(["wa", u && [u.id, u.after], [wc.latestWaId, wc.newWaQuantity, wc.newWaCostPrice]]);
  }
  const uom = node(rec, "code_node_mvszWJ8p");
  if (uom && !eq(plan.movements[0].base_qty, uom.baseQty)) diffs.push(["base_qty", plan.movements[0].base_qty, uom.baseQty]);
  if (diffs.length) return bump("DIFF:values", rec, diffs);
  bump("ok:identical", rec);
}

const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
for (const l of lines) {
  const rec = JSON.parse(l);
  try {
    (kind === "ADD" ? addCase : subtractCase)(rec);
  } catch (e) {
    bump("ERROR:" + e.message.slice(0, 80), rec);
  }
}
console.log(kind, lines.length, "runs");
for (const k of Object.keys(tally).sort()) console.log(String(tally[k]).padStart(6), k);
for (const k of Object.keys(examples).filter((x) => x.indexOf("ok:") !== 0)) {
  console.log("\n== " + k);
  for (const e of examples[k]) console.log(JSON.stringify(e).slice(0, 700));
}
