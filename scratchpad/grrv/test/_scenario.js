// A Goods Receiving built in the SQL reads' shapes (prepare/sql.py: `j` / `k` rows), consistent the way a completion leaves
// it, for the unit and synthetic harnesses. spec:
//   { lines: [{ item, qty, base?, price?, bin?, cat?, poLine?, batch?, split?: [qty, ...] (a split parent and its children),
//               putaway?: [[bin, qty], ...] (a completed putaway moves the line's stock on), transit?: true, ret?: qty }],
//     items: { <item>: { method: "First In First Out" | "Weighted Average", batch?: bool, serial?: bool, uomBase?: number } },
//     header?: { <column>: value }, wa?: { <item>: [qty, price] } (the running average row of a non-batch WA item),
//     fifoConsumed?: { <line index>: available }, extraRows?: { ibal: n, bbal: n, items: n, oo: n, transit: n } }
// Ids: digit strings from a 19-digit base; the receipt is Processing under H.TEST_JOB with a LOCK row of H.TEST_KEY.
const H = require("./_harness");
let seq = 0n;
const BASE = 2200000000000000000n;
const id = () => String(BASE + ++seq);
const J = (o) => ({ j: JSON.stringify(o) });
const K = (k, o) => ({ k: k, j: JSON.stringify(o) });
const d8 = (v) => Number(v).toFixed(8);

function scenario(spec) {
  seq = 0n;
  const T = "000000";
  const org = "1123598813738675201";
  const plant = "1123598813738675202";
  const grId = id();
  const grNo = "GR/TEST" + grId.slice(-6);
  const po = id();
  const uom = "2018906563477008392";
  const recvBin = "2034476113458442241";
  const items = {};
  for (const [name, it] of Object.entries(spec.items || {})) items[name] = Object.assign({ id: id() }, it);
  const S = { hdr: [], lines: [], movs: [], lock: [{ step_name: "LOCK|1", result_ref: H.TEST_KEY }], putaway: [], qi: [], transit: [], batches: [], later: [], fifo: [], wa: [],
    costcounts: [], pi: [], bbal: [], ibal: [], hu: [], po: [], oo: [], items: [] };
  const hdr = Object.assign({ id: grId, gr_no: grNo, gr_status: "Processing", gr_v2_job_id: H.TEST_JOB, organization_id: org, plant_id: plant, tenant_id: T, is_deleted: 0,
    previous_status: "Created", putaway_status: "", po_id: [po], update_time: "2026-10-15 10:00:00.000" }, spec.header || {});
  S.hdr.push(J(hdr));
  S.po.push(K("PO", { id: po, purchase_order_no: "PO/TEST", po_status: "Completed", gr_status: "Fully Received", organization_id: org, update_time: "2026-10-15 10:00:00.000" }));
  const balances = {};
  const fifoCount = {};
  const waSeen = {};
  const toId = id();
  let toLines = 0;
  const movs = [];
  const live = [];
  (spec.lines || []).forEach((l, i) => {
    const it = items[l.item];
    const lineId = id();
    const poLine = l.poLine || id();
    const price = l.price === undefined ? 5 : l.price;
    // base_received_qty as the line holds it (0 = none: completion then posts the received quantity)
    const baseCol = l.base === undefined ? l.qty : l.base;
    const base = baseCol || l.qty;
    const batch = it.batch ? id() : null;
    const row = { id: lineId, goods_receiving_id: grId, line_index: String(i + 1), item_id: it.id, received_qty: l.qty, base_received_qty: baseCol, unit_price: price,
      po_line_item_id: poLine, line_po_id: po, location_id: l.bin || recvBin, inv_category: l.cat || "Unrestricted", parent_index: i, is_split: l.split ? "Yes" : "No",
      parent_or_child: "Parent", return_quantity: l.ret || 0, created_return_qty: 0, organization_id: org, plant_id: plant, tenant_id: T, is_deleted: 0 };
    S.lines.push(Object.assign(J(row), { sn: it.serial ? 1 : 0 }));
    S.po.push(K("POL", { id: poLine, purchase_order_id: po, item_id: it.id, line_index: String(i + 1), quantity: l.qty, received_qty: l.qty, created_received_qty: 0,
      outstanding_quantity: 0, line_status: "Completed" }));
    S.oo.push(J({ id: id(), po_line_id: poLine, po_id: po, material_id: it.id, plant_id: plant, organization_id: org, scheduled_qty: base, received_qty: base, open_qty: 0 }));
    // the rows that add stock: the line, or its split children
    const adds = l.split ? l.split.map((q, k) => {
      const child = { id: id(), goods_receiving_id: grId, item_id: it.id, received_qty: q, base_received_qty: q, unit_price: price, po_line_item_id: poLine, line_po_id: po,
        location_id: l.bin || recvBin, inv_category: l.cat || "Unrestricted", parent_index: i, is_split: "No", parent_or_child: "Child", parent_id: null,
        return_quantity: 0, created_return_qty: 0, organization_id: org, plant_id: plant, tenant_id: T, is_deleted: 0 };
      S.lines.push(Object.assign(J(child), { sn: 0 }));
      return q;
    }) : [base];
    for (const q of adds) {
      const m = { id: id(), transaction_type: "GRN", movement: "IN", trx_no: grNo, parent_trx_no: "PO/TEST", item_id: it.id, plant_id: plant, bin_location_id: l.bin || recvBin,
        batch_number_id: batch, inventory_category: l.cat || "Unrestricted", quantity: d8(q), base_qty: d8(q), uom_id: uom, base_uom_id: uom, unit_price: d8(price),
        costing_method_id: it.method };
      movs.push(m);
      live.push({ m: m, it: it, q: q, price: price, batch: batch });
      if (it.method === "First In First Out") {
        const avail = spec.fifoConsumed && spec.fifoConsumed[i] !== undefined ? spec.fifoConsumed[i] : q;
        S.fifo.push(J({ id: id(), material_id: it.id, batch_id: batch, fifo_cost_price: d8(price), fifo_initial_quantity: d8(q), fifo_available_quantity: d8(avail), fifo_sequence: "1" }));
        fifoCount[it.id] = (fifoCount[it.id] || 0) + 1;
      } else if (batch) {
        S.wa.push(J({ id: id(), material_id: it.id, batch_id: batch, wa_quantity: d8(q), wa_cost_price: d8(price) }));
        waSeen[it.id] = (waSeen[it.id] || 0) + 1;
      }
    }
    if (batch) S.batches.push(J({ id: batch, batch_number: "B" + batch.slice(-5), material_id: it.id, plant_id: plant, organization_id: org, transaction_no: grNo, initial_quantity: base }));
    // where the stock sits now: the receiving bin, or wherever the putaway took it
    const places = l.putaway ? l.putaway : [[l.bin || recvBin, base]];
    if (l.putaway) {
      for (const [bin, q] of l.putaway) {
        movs.push({ id: id(), transaction_type: "TO - PA", movement: "OUT", trx_no: "TRF-PA-TEST", parent_trx_no: grNo, item_id: it.id, plant_id: plant, bin_location_id: l.bin || recvBin,
          batch_number_id: batch, inventory_category: l.cat || "Unrestricted", quantity: d8(q), base_qty: d8(q), uom_id: uom, base_uom_id: uom, unit_price: d8(price), costing_method_id: it.method });
        movs.push({ id: id(), transaction_type: "TO - PA", movement: "IN", trx_no: "TRF-PA-TEST", parent_trx_no: grNo, item_id: it.id, plant_id: plant, bin_location_id: bin,
          batch_number_id: batch, inventory_category: "Unrestricted", quantity: d8(q), base_qty: d8(q), uom_id: uom, base_uom_id: uom, unit_price: d8(price), costing_method_id: it.method });
      }
      S.putaway.push(K("TOL", { id: id(), transfer_order_putaway_id: toId, line_index: String(++toLines), item_code: it.id, batch_no: batch, line_status: "Completed",
        received_qty: base, qty_to_putaway: base, pending_process_qty: 0, putaway_qty: 0, is_split: "No", parent_or_child: "Parent", gr_line_id: lineId }));
    }
    for (const [bin, q] of places) {
      const cat = l.putaway ? "Unrestricted" : l.cat || "Unrestricted";
      const col = cat === "In Transit" ? "intransit_qty" : cat === "Quality Inspection" ? "qualityinsp_qty" : cat === "Blocked" ? "block_qty" : "unrestricted_qty";
      for (const k of [it.id + "|" + bin + "|", batch ? it.id + "|" + bin + "|" + batch : null].filter(Boolean)) {
        balances[k] = balances[k] || { material_id: it.id, location_id: bin, plant_id: plant, organization_id: org, unrestricted_qty: 0, reserved_qty: 0, block_qty: 0,
          qualityinsp_qty: 0, intransit_qty: 0, balance_quantity: 0, batch_id: k.split("|")[2] || null };
        balances[k][col] += q;
        balances[k].balance_quantity += q;
      }
    }
    if (l.transit) S.transit.push(J({ id: id(), doc_type: "Goods Receiving", doc_id: grId, doc_no: grNo, doc_line_id: lineId, material_id: it.id, batch_id: batch, plant_id: plant,
      organization_id: org, transit_bin: recvBin, transit_qty: base, received_qty: base, open_qty: 0, status: "Received", target_doc_type: "Putaway", target_doc_id: toId }));
  });
  if (toLines) S.putaway.unshift(K("TO", { id: toId, to_id: "TRF-PA-TEST", to_status: "Completed", is_processing: 0, gr_no: grId, receiving_no: grNo, organization_id: org, plant_id: plant }));
  S.movs = movs.map(J);
  for (const b of Object.values(balances)) {
    const row = Object.assign({ id: id() }, b);
    if (b.batch_id) S.bbal.push(J(row));
    else {
      delete row.batch_id;
      S.ibal.push(J(row));
    }
  }
  for (const [name, it] of Object.entries(items)) {
    S.items.push(K("I", { id: it.id, material_code: name, material_name: name, based_uom: uom, material_costing_method: it.method, stock_control: 1, item_batch_management: it.batch ? 1 : 0,
      serial_number_management: it.serial ? 1 : 0, organization_id: org }));
    S.items.push(K("U", { id: id(), Item_id: it.id, alt_uom_id: uom, alt_qty: 1, base_qty: it.uomBase || 1, base_uom_id: uom }));
    if (fifoCount[it.id]) S.costcounts.push(J({ t: "FIFO", material_id: it.id, cnt: fifoCount[it.id] }));
    if (it.method === "Weighted Average" && !it.batch) {
      const [q, p] = (spec.wa && spec.wa[name]) || [1000, 5];
      S.wa.unshift(J({ id: id(), material_id: it.id, wa_quantity: d8(q), wa_cost_price: d8(p) }));
      waSeen[it.id] = (waSeen[it.id] || 0) + 1;
    }
    if (waSeen[it.id]) S.costcounts.push(J({ t: "WA", material_id: it.id, cnt: waSeen[it.id] }));
  }
  const entry = { route: "GO", jobId: H.TEST_JOB, tenantId: T, organizationId: org, grId: grId, idempotencyKey: H.TEST_KEY, rowVersion: 1, dbNow: "2026-10-15 12:00:00",
    nonce: "Ab12Cd34", request: { v: 1, source: "TEST", uid: "1", previousStatus: spec.prev || "Completed", grId: grId, grNo: grNo }, result_code: "", result_message: "" };
  return { S: S, entry: entry, grId: grId, grNo: grNo, items: items, live: live, plant: plant, org: org, po: po };
}

// S + entry -> the assembled VPprep, then VPplan (and the SUBMIT gate on the same rows, before the lock)
function plan(sc, opts) {
  const prep = H.runNode("VPprep", H.prepCtx(sc.entry, sc.S), opts);
  const p = H.runNode("VPplan", H.planCtx(sc.entry, prep.out, sc.S), opts);
  return { prep: prep, plan: p, parts: p.out.route === "READY" ? partsOf(p.out) : null };
}
function gate(sc) {
  const h = H.parseBig(sc.S.hdr[0].j);
  h.gr_status = sc.entry.request.previousStatus;
  const S = Object.assign({}, sc.S, { hdr: [J(h)] });
  return H.runNode("VSgate", H.gateCtx({ route: "GO", tenantId: sc.entry.tenantId, grId: sc.grId, organizationId: sc.org }, S)).out;
}
function partsOf(out) {
  const man = JSON.parse(out.payload);
  const parts = {};
  for (const name of Object.keys(man.parts)) parts[name] = JSON.parse(out.partRows.filter((r) => man.parts[name].includes(r.step_name)).map((r) => r.result_ref).join(""));
  parts.manifest = man;
  return parts;
}
module.exports = { scenario, plan, gate, partsOf, J, K, id, d8 };
