// INVENTORY_BULK_APPLY plan: replay the movements over the rows read (fresh), or compare a stored intent with them (resume)
//@include ../../engine/core.js
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const dec = (v) => {
  const t = q8(v).toFixed(8).replace(/\.?0+$/, "");
  return t === "-0" || t === "" ? "0" : t;
};
const SLICE = 250;
const CHUNK = 400000;

const bulkPlan = function bulkPlan(inp) {
  if (s(inp.lockRoute) === "LOST") return { route: "LOST", result_code: "LOCK_BUSY", result_message: "Another operation took a lock before this one could" };
  const route0 = s(inp.route);
  const op = s(inp.operationKey);
  const org = s(inp.organizationId);
  let movements = inp.movements;
  if (typeof movements === "string") movements = JSON.parse(movements);
  const items = {};
  for (const r of arr(inp.items)) {
    let conv = r.uom_conversion_json;
    if (typeof conv === "string") {
      try {
        conv = JSON.parse(conv);
      } catch (e) {
        conv = [];
      }
    }
    items[s(r.id)] = {
      id: s(r.id),
      stock_control: Number(r.stock_control),
      based_uom: s(r.based_uom),
      material_costing_method: r.material_costing_method,
      purchase_unit_price: Number(r.purchase_unit_price || 0),
      item_batch_management: Number(r.item_batch_management || 0),
      table_uom_conversion: arr(conv).map((c) => ({ alt_uom_id: s(c.alt_uom_id), base_qty: Number(c.base_qty) })),
    };
  }
  const num = (rows, cols) =>
    arr(rows).map((r) => {
      const o = Object.assign({}, r);
      for (const c of cols) if (o[c] !== undefined && o[c] !== null && o[c] !== "") o[c] = Number(o[c]);
      return o;
    });
  const QTY = ["unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"];
  const bal = num(inp.itemBalances, QTY);
  const batch = num(inp.batchBalances, QTY);
  const fifo = num(inp.fifoLayers, ["fifo_available_quantity", "fifo_cost_price"]).map((r) => Object.assign(r, { batch_id: s(r.batch_id) === "0" ? null : r.batch_id }));
  const wa = num(inp.waRows, ["wa_quantity", "wa_cost_price"]).map((r) => Object.assign(r, { batch_id: s(r.batch_id) === "0" ? null : r.batch_id }));

  // the tenant's number rules as configured now (defaults "Inventory Price" 4 / "Inventory Qty" 3, customisable per tenant
  // and per column): decimals, precision_rule (1 half-up, 2 toward zero, 3 away from zero), store_raw_value = no rounding
  const TABLE_OF = { "1902698977724317697": "item_balance", "1902718803880558594": "item_batch_balance", "1902947165008400386": "fifo_costing_history",
    "1902948453171433474": "wa_costing_method", "1902259348776800257": "inventory_movement", "1902719754154655746": "batch" };
  const precision = { price: null, qty: null, columns: {} };
  let precisionProblem = "";
  for (const r of arr(inp.precision)) {
    const mode = Number(r.precision_rule);
    const dp = Number(r.decimal_places);
    if ([1, 2, 3].indexOf(mode) < 0 || !(dp >= 0)) {
      precisionProblem = precisionProblem || "number rule " + s(r.rule_key || r.field_name) + ": precision_rule " + s(r.precision_rule) + ", decimals " + s(r.decimal_places);
      continue;
    }
    const rule = Number(r.store_raw_value) === 1 || dp >= 8 ? { dp: null, mode: mode } : { dp: dp, mode: mode };
    if (s(r.scope_type) === "2") {
      if (TABLE_OF[s(r.table_id)] && s(r.field_name)) precision.columns[TABLE_OF[s(r.table_id)] + "." + s(r.field_name)] = rule;
    } else if (s(r.rule_key) === "Inventory Price") precision.price = rule;
    else if (s(r.rule_key) === "Inventory Qty") precision.qty = rule;
  }

  let plan;
  let fromIntent = false;
  if (route0 === "RESUME") {
    plan = JSON.parse(s(inp.intentText));
    fromIntent = true;
  } else {
    if (precisionProblem) return { route: "FAIL", code: "400", result_code: "UNSUPPORTED_PRECISION", result_message: "The tenant's " + precisionProblem + " is not a rounding the platform documents" };
    plan = planBulk({ operationKey: op, items, itemBalances: bal, batchBalances: batch, fifoLayers: fifo, waRows: wa, movements, nowText: s(inp.dbNow), precision: precision });
    if (!plan.ok) {
      return { route: "FAIL", code: "400", result_code: plan.failure.code, result_message: plan.failure.message + " (movement " + plan.failure.movement_key + ")", failure: plan.failure, results: plan.results };
    }
    if (route0 === "PLAN") {
      return { route: "PLAN_OK", code: "200", result_code: "OK", result_message: "Planned " + plan.results.length + " movements", results: plan.results, summary: summaryOf(plan) };
    }
  }

  // which planned rows still need writing: equal to after -> done; equal to before -> write; else someone else changed it
  const current = {
    item_balance: index(bal),
    item_batch_balance: index(batch),
    fifo: index(fifo),
    wa: index(wa),
  };
  const conflicts = [];
  const pending = {};
  for (const t of ["item_balance", "item_batch_balance", "fifo", "wa"]) {
    pending[t] = [];
    for (const u of arr(plan.updates[t])) {
      const row = current[t][s(u.id)];
      if (!row) {
        conflicts.push(t + " " + u.id + " is gone");
        continue;
      }
      if (sameCols(row, u.after)) continue;
      if (sameCols(row, u.before)) pending[t].push(u);
      else conflicts.push(t + " " + u.id + " changed since the plan");
    }
  }
  const createsLeft = { item_balance: [], item_batch_balance: [], fifo: [], wa: [] };
  for (const t of Object.keys(createsLeft)) {
    for (const c of arr(plan.creates[t])) {
      if (!fromIntent) {
        createsLeft[t].push(c);
        continue;
      }
      const hit = findCreated(t, c, { item_balance: bal, item_batch_balance: batch, fifo, wa });
      if (hit === "SAME") continue;
      if (hit === "ABSENT") createsLeft[t].push(c);
      else conflicts.push(t + " new row " + naturalKey(t, c) + " differs");
    }
  }
  const haveMv = {};
  for (const r of arr(inp.existingMovements)) haveMv[s(r.operation_effect_key)] = true;
  const mvLeft = arr(plan.movements).filter((m) => !haveMv[s(m.operation_effect_key)]);
  if (conflicts.length) {
    return { route: "REVIEW", result_code: "REQUIRES_REVIEW", result_message: "Rows changed under a stored plan: " + conflicts.slice(0, 10).join("; "), results: plan.results };
  }

  const ib = pending.item_balance.map((u) => Object.assign({ id: s(u.id) }, decCols(u.after)));
  // SUBTRACT writes only the quantities; ADD also the remarks - kept apart so a quantity-only row never blanks a remark
  const bbAll = pending.item_batch_balance.map((u) => Object.assign({ id: s(u.id) }, decCols(u.after)));
  const bb = bbAll.filter((r) => !("remark" in r));
  const bbr = bbAll.filter((r) => "remark" in r);
  const ff = pending.fifo.map((u) => ({ id: s(u.id), fifo_available_quantity: dec(u.after.fifo_available_quantity) }));
  const wr = pending.wa.map((u) => ({ id: s(u.id), wa_quantity: dec(u.after.wa_quantity), wa_cost_price: dec(u.after.wa_cost_price) }));
  const strip = (r) => {
    const o = Object.assign({}, r);
    delete o.id;
    delete o.created_at;
    return decCols(o);
  };
  const mv = mvLeft.map((m) => {
    const o = Object.assign({}, m);
    for (const c of ["unit_price", "total_price", "quantity", "base_qty", "actual_qty", "actual_base_qty"]) o[c] = dec(o[c]);
    if (o.handling_unit_id === "") o.handling_unit_id = null;
    return o;
  });
  const slices = (n) => {
    const out = [];
    for (let i = 0; i < n; i += SLICE) out.push({ from: i });
    return out;
  };
  let intentRows = [];
  if (!fromIntent) {
    const text = JSON.stringify(plan);
    const parts = [];
    for (let i = 0; i < text.length; i += CHUNK) parts.push(text.slice(i, i + CHUNK));
    intentRows = parts.map((p, i) => ({ job_id: op, organization_id: org, step_name: "IBA|I|" + String(i + 1).padStart(3, "0"), step_status: "INTENT", attempt_count: 0, result_ref: p }));
  }
  const ids = (rows) => rows.map((r) => r.id).filter((x) => /^[0-9]{1,20}$/.test(x)).join(",") || "0";
  return {
    route: "WRITE",
    result_code: "OK",
    result_message: "",
    results: plan.results,
    summary: summaryOf(plan),
    intentRows: intentRows,
    needIntent: intentRows.length ? "YES" : "NO",
    ib: ib,
    ibSlices: slices(ib.length),
    bb: bb,
    bbSlices: slices(bb.length),
    bbr: bbr,
    bbrSlices: slices(bbr.length),
    ff: ff,
    ffSlices: slices(ff.length),
    wa: wr,
    waSlices: slices(wr.length),
    ibNew: createsLeft.item_balance.map(strip),
    ibNewSlices: slices(createsLeft.item_balance.length),
    bbNew: createsLeft.item_batch_balance.map(strip),
    bbNewSlices: slices(createsLeft.item_batch_balance.length),
    ffNew: createsLeft.fifo.map(strip),
    ffNewSlices: slices(createsLeft.fifo.length),
    waNew: createsLeft.wa.map(strip),
    waNewSlices: slices(createsLeft.wa.length),
    needNew: createsLeft.item_balance.length + createsLeft.item_batch_balance.length + createsLeft.fifo.length + createsLeft.wa.length ? "YES" : "NO",
    mv: mv,
    mvSlices: slices(mv.length),
    // the read-back checks every planned row, written now or by an earlier run
    expect: {
      item_balance: arr(plan.updates.item_balance).map((u) => [s(u.id), u.after]),
      item_batch_balance: arr(plan.updates.item_batch_balance).map((u) => [s(u.id), u.after]),
      fifo: arr(plan.updates.fifo).map((u) => [s(u.id), u.after]),
      wa: arr(plan.updates.wa).map((u) => [s(u.id), u.after]),
      movements: arr(plan.movements).length,
    },
    expectCreates: ["item_balance", "item_batch_balance", "fifo", "wa"].flatMap((t) =>
      arr(plan.creates[t]).map((c) => ({ table: t, key: keyFields(t, c), values: valueFields(t, c) })),
    ),
    ibIdsSql: ids(arr(plan.updates.item_balance)),
    bbIdsSql: ids(arr(plan.updates.item_batch_balance)),
    ffIdsSql: ids(arr(plan.updates.fifo)),
    waIdsSql: ids(arr(plan.updates.wa)),
  };

  function index(rows) {
    const o = {};
    for (const r of rows) o[s(r.id)] = r;
    return o;
  }
  function sameCols(row, want) {
    for (const c of Object.keys(want || {})) {
      const a = want[c];
      const b = row[c];
      if (typeof a === "number" || (a !== null && a !== "" && !isNaN(Number(a)) && c.indexOf("remark") < 0)) {
        if (Math.abs(q8(a) - q8(b)) > 1e-8) return false;
      } else if (s(a) !== s(b)) return false;
    }
    return true;
  }
  function decCols(o) {
    const r = Object.assign({}, o);
    for (const c of QTY.concat(["fifo_cost_price", "fifo_initial_quantity", "fifo_available_quantity", "wa_quantity", "wa_cost_price", "initial_quantity"])) {
      if (r[c] !== undefined && r[c] !== null) r[c] = dec(r[c]);
    }
    return r;
  }
  function naturalKey(t, c) {
    if (t === "item_balance") return [c.material_id, c.location_id, c.plant_id].join("|");
    if (t === "item_batch_balance") return [c.material_id, c.location_id, c.batch_id, c.plant_id].join("|");
    if (t === "fifo") return [c.material_id, c.plant_id, c.batch_id, String(parseInt(c.fifo_sequence || 0, 10))].join("|");
    return [c.material_id, c.plant_id, c.batch_id].join("|");
  }
  function keyFields(t, c) {
    const k = { material_id: s(c.material_id), plant_id: s(c.plant_id) };
    if (t === "item_balance" || t === "item_batch_balance") k.location_id = s(c.location_id);
    if (t !== "item_balance") k.batch_id = c.batch_id === undefined || c.batch_id === null ? null : s(c.batch_id);
    if (t === "fifo") k.fifo_sequence = String(parseInt(c.fifo_sequence || 0, 10));
    return k;
  }
  function valueFields(t, c) {
    const cols = t === "fifo" ? ["fifo_initial_quantity"] : t === "wa" ? ["wa_quantity", "wa_cost_price"] : QTY;
    const o = {};
    for (const col of cols) o[col] = c[col];
    return o;
  }
  function findCreated(t, c, rows) {
    const k = naturalKey(t, c);
    const hit = arr(rows[t]).filter((r) => naturalKey(t, r) === k);
    if (!hit.length) return "ABSENT";
    const cols = t === "fifo" ? ["fifo_initial_quantity"] : t === "wa" ? ["wa_quantity", "wa_cost_price"] : QTY;
    const want = {};
    for (const col of cols) want[col] = c[col];
    return hit.some((r) => sameCols(r, want)) ? "SAME" : "OTHER";
  }
};

function summaryOf(plan) {
  const u = plan.updates || {};
  const c = plan.creates || {};
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  return {
    movements: n(plan.movements),
    skipped: (plan.results || []).filter((r) => r.code === "401").length,
    item_balance: n(u.item_balance) + n(c.item_balance),
    item_batch_balance: n(u.item_batch_balance) + n(c.item_batch_balance),
    fifo: n(u.fifo) + n(c.fifo),
    wa: n(u.wa) + n(c.wa),
  };
}

return bulkPlan({
  route: [{{node:code_node_IBstate.data.route}}][0],
  dbNow: [{{node:code_node_IBstate.data.dbNow}}][0],
  intentText: [{{node:code_node_IBstate.data.intentText}}][0],
  operationKey: [{{node:code_node_IBguard.data.operationKey}}][0],
  organizationId: [{{node:code_node_IBguard.data.organizationId}}][0],
  movements: [{{workflowparams:movements}}][0],
  lockRoute: [{{node:code_node_IBlkv.data.route}}][0],
  items: [{{node:sql_node_IBitems.data}}][0],
  itemBalances: [{{node:sql_node_IBbal.data}}][0],
  batchBalances: [{{node:sql_node_IBbatch.data}}][0],
  fifoLayers: [{{node:sql_node_IBfifo.data}}][0],
  waRows: [{{node:sql_node_IBwa.data}}][0],
  existingMovements: [{{node:sql_node_IBmv.data}}][0],
  precision: [{{node:sql_node_IBprec.data}}][0],
});
