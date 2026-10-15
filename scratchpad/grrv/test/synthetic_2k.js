// Harness (d): a synthetic receipt of N lines (default 2,000) built from a real dev receipt's rows (run_prepare_sql.py dump;
// every row cloned at full width, so the sizes are real): one item, batch, FIFO layer, PO line, on-order row, balance pair,
// in-transit row and completed-putaway line per receipt line, the putaway moving each line's stock to another bin (one in
// ten split over two bins). The assembled VPprep -> VPplan and VSgate run on it: time, the manifest, and the node data the
// platform records (each read's rows, each code node's substituted inputs and its answer). No customer data is printed.
// usage: TZ=Asia/Kuala_Lumpur [PUTAWAY=0] node synthetic_2k.js <dir>/dev_<gr_id>.json [lines=2000]   (PUTAWAY=0: no putaway, the
// stock stays in the receiving bin - one movement row per line instead of three)
const fs = require("fs");
const H = require("./_harness");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const [file, nArg] = process.argv.slice(2);
const N = Number(nArg || 2000);
const PA = process.env.PUTAWAY !== "0";
const T = JSON.parse(fs.readFileSync(file, "utf8"));
const P = (r) => H.parseBig(r.j);
// rows carry the columns prepare/sql.py reads and no others (SHAPES), so the sizes are the reads'
const SHAPES = JSON.parse(require("child_process").execFileSync("python3", [require("path").join(H.D, "prepare", "sql.py"), "--shapes"], { encoding: "utf8" }));
const pick = (shape, o) => Object.fromEntries(SHAPES[shape].filter((c) => o[c] !== undefined && o[c] !== null && o[c] !== "").map((c) => [c, o[c]]));
const J = (o, shape) => ({ j: JSON.stringify(shape ? pick(shape, o) : o) });
const K = (k, o) => ({ k: k, j: JSON.stringify(pick(k, o)) });
let seq = 0n;
const hdr0 = P(T.hdr[0]);
const id = () => String(BigInt(hdr0.id) + 1000n + ++seq);
const d8 = (v) => Number(v).toFixed(8);
const first = (rows, k) => (rows || []).filter((r) => !k || r.k === k).map(P)[0];
const tpl = { line: first(T.lines), mov: first(T.movs), to: first(T.putaway, "TO"), tol: first(T.putaway, "TOL"), it: first(T.transit), fifo: first(T.fifo),
  bbal: first(T.bbal), ibal: first(T.ibal), poh: first(T.po, "PO"), pol: first(T.po, "POL"), oo: first(T.oo), item: first(T.items, "I"), uom: first(T.items, "U"),
  batch: first(T.batches) };
for (const [k, v] of Object.entries(tpl)) if (!v) throw new Error("the template receipt has no " + k + " row: pick one with batches, putaway, in-transit, FIFO, PO lines");
const BIN_A = String(tpl.mov.bin_location_id);
const BIN_B = String(tpl.ibal.location_id) === BIN_A ? "2018912972444823554" : String(tpl.ibal.location_id);
const BIN_C = "2065350054772584449";
const po = id();
const to = id();
const grNo = String(hdr0.gr_no);
const S = { hdr: [], lines: [], movs: [], lock: [{ step_name: "LOCK|1", result_ref: H.TEST_KEY }], putaway: [], qi: [], transit: [], batches: [], later: [], fifo: [], wa: [], costcounts: [],
  pi: [], bbal: [], ibal: [], hu: [], po: [], oo: [], items: [] };
const hdr = Object.assign({}, hdr0, { gr_status: "Processing", gr_v2_job_id: H.TEST_JOB, po_id: [po], putaway_status: "Completed", pi_status: null, return_status: null, posted_status: null });
S.hdr.push(J(hdr));
S.po.push(K("PO", Object.assign({}, tpl.poh, { id: po })));
if (PA) S.putaway.push(K("TO", Object.assign({}, tpl.to, { id: to, gr_no: String(hdr0.id), to_status: "Completed", is_processing: 0 })));
const movs = [];
for (let i = 0; i < N; i++) {
  const item = id();
  const batch = id();
  const line = id();
  const pol = id();
  const q = 1 + (i % 7);
  const price = tpl.mov.unit_price;
  S.items.push(K("I", Object.assign({}, tpl.item, { id: item, material_code: "SYN-" + i, material_costing_method: "First In First Out", stock_control: 1, serial_number_management: 0 })));
  S.items.push(K("U", Object.assign({}, tpl.uom, { id: id(), Item_id: item, alt_uom_id: tpl.mov.base_uom_id, base_uom_id: tpl.mov.base_uom_id, base_qty: 1 })));
  S.lines.push(Object.assign(J(Object.assign({}, tpl.line, { id: line, item_id: item, line_index: String(i + 1), parent_index: i, received_qty: q, base_received_qty: q,
    po_line_item_id: pol, line_po_id: po, item_batch_no: "SYN" + i, is_split: "No", parent_or_child: "Parent", return_quantity: 0, created_return_qty: 0 }), "lines"), { sn: 0 }));
  S.po.push(K("POL", Object.assign({}, tpl.pol, { id: pol, purchase_order_id: po, item_id: item, quantity: q, received_qty: q, created_received_qty: 0, outstanding_quantity: 0,
    line_status: "Completed", parent_id: null, item_bundle_id: null })));
  S.oo.push(J(Object.assign({}, tpl.oo, { id: id(), po_line_id: pol, po_id: po, material_id: item, scheduled_qty: q, received_qty: q, open_qty: 0 }), "oo"));
  S.batches.push(J(Object.assign({}, tpl.batch, { id: batch, material_id: item, transaction_no: grNo, parent_transaction_no: null, initial_quantity: q }), "batches"));
  movs.push(Object.assign({}, tpl.mov, { id: id(), item_id: item, batch_number_id: batch, quantity: d8(q), base_qty: d8(q), trx_no: grNo, transaction_type: "GRN", movement: "IN",
    bin_location_id: BIN_A, inventory_category: "In Transit", costing_method_id: "First In First Out" }));
  S.fifo.push(J(Object.assign({}, tpl.fifo, { id: id(), material_id: item, batch_id: batch, fifo_cost_price: price, fifo_initial_quantity: d8(q), fifo_available_quantity: d8(q) }), "fifo"));
  S.costcounts.push(J({ t: "FIFO", material_id: item, cnt: 1 }));
  // the putaway: In Transit at the receiving bin -> Unrestricted at one bin (one in ten lines over two)
  const split = !PA ? [] : i % 10 === 0 && q > 1 ? [[BIN_B, q - 1], [BIN_C, 1]] : [[BIN_B, q]];
  if (!PA) {
    const bal = { material_id: item, location_id: BIN_A, unrestricted_qty: 0, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, intransit_qty: q + 3, balance_quantity: q + 3 };
    S.ibal.push(J(Object.assign({}, tpl.ibal, bal, { id: id() }), "ibal"));
    S.bbal.push(J(Object.assign({}, tpl.bbal, bal, { id: id(), batch_id: batch }), "bbal"));
  }
  for (const [bin, qq] of split) {
    movs.push(Object.assign({}, tpl.mov, { id: id(), item_id: item, batch_number_id: batch, quantity: d8(qq), base_qty: d8(qq), trx_no: tpl.to.to_id, parent_trx_no: grNo,
      transaction_type: "TO - PA", movement: "OUT", bin_location_id: BIN_A, inventory_category: "In Transit", costing_method_id: "First In First Out" }));
    movs.push(Object.assign({}, tpl.mov, { id: id(), item_id: item, batch_number_id: batch, quantity: d8(qq), base_qty: d8(qq), trx_no: tpl.to.to_id, parent_trx_no: grNo,
      transaction_type: "TO - PA", movement: "IN", bin_location_id: bin, inventory_category: "Unrestricted", costing_method_id: "First In First Out" }));
    const bal = { material_id: item, location_id: bin, unrestricted_qty: qq + 3, reserved_qty: 0, block_qty: 0, qualityinsp_qty: 0, intransit_qty: 0, balance_quantity: qq + 3 };
    S.ibal.push(J(Object.assign({}, tpl.ibal, bal, { id: id() }), "ibal"));
    S.bbal.push(J(Object.assign({}, tpl.bbal, bal, { id: id(), batch_id: batch }), "bbal"));
  }
  if (PA) S.putaway.push(K("TOL", Object.assign({}, tpl.tol, { id: id(), transfer_order_putaway_id: to, item_code: item, batch_no: batch, line_status: "Completed", gr_line_id: line,
    received_qty: q, qty_to_putaway: q, putaway_qty: 0, pending_process_qty: 0, parent_id: null })));
  if (PA) S.transit.push(J(Object.assign({}, tpl.it, { id: id(), doc_id: String(hdr0.id), doc_line_id: line, material_id: item, batch_id: batch, transit_qty: q, received_qty: q, open_qty: 0,
    status: "Received", target_doc_id: to }), "transit"));
}
S.movs = movs.map((m) => J(m, "movs"));
const L = { entry: { route: "GO", jobId: H.TEST_JOB, tenantId: String(T._vals.tenantId), organizationId: String(hdr0.organization_id), grId: String(hdr0.id), idempotencyKey: H.TEST_KEY,
  rowVersion: 1, dbNow: "2026-10-15 12:00:00", nonce: "Ab12Cd34", request: { v: 1, source: "TEST", uid: "1", previousStatus: "Completed", grId: String(hdr0.id), grNo: grNo },
  result_code: "", result_message: "" } };
const size = (v) => Buffer.byteLength(JSON.stringify(v === undefined ? null : v), "utf8");
const MB = (n) => (n / 1048576).toFixed(2) + " MB";
const prepCtx = H.prepCtx(L.entry, S);
const t0 = Date.now();
const prep = H.runNode("VPprep", prepCtx);
const planCtx = H.planCtx(L.entry, prep.out, S);
const plan = H.runNode("VPplan", planCtx);
const gateS = Object.assign({}, S, { hdr: [J(Object.assign({}, hdr, { gr_status: "Completed" }))] });
const gateCtx = H.gateCtx({ route: "GO", tenantId: L.entry.tenantId, grId: L.entry.grId, organizationId: L.entry.organizationId }, gateS);
const gate = H.runNode("VSgate", gateCtx);
const wall = Date.now() - t0;
if (plan.out.route !== "READY") {
  console.log("plan:", plan.out.route, plan.out.code, plan.out.message.slice(0, 300));
  process.exit(1);
}
const man = JSON.parse(plan.out.payload);
const reads1 = ["hdr", "lines", "movs", "putaway", "qi", "transit", "batches", "lock"].reduce((n, k) => n + size(S[k]), 0);
const reads2 = ["later", "fifo", "wa", "costcounts", "pi", "bbal", "ibal", "hu", "po", "oo", "items"].reduce((n, k) => n + size(S[k]), 0);
const req = (ctx) => Object.values(ctx).reduce((n, v) => n + size(v), 0);
const prepIn = req(prepCtx);
const planIn = req(planCtx);
const total = reads1 + prepIn + size(prep.out) + reads2 + planIn + size(plan.out);
const partBytes = {};
for (const r of plan.out.partRows) partBytes[r.step_name.split("|")[2]] = (partBytes[r.step_name.split("|")[2]] || 0) + r.result_ref.length;
console.log(`${N} lines, ${S.movs.length} movement rows read: plan ${plan.out.route} ${plan.out.message} | VPprep ${prep.ms.toFixed(0)} ms, VPplan ${plan.ms.toFixed(0)} ms, VSgate ${gate.ms.toFixed(0)} ms (${gate.out.route}), wall ${wall} ms`);
console.log(`  manifest: header ${plan.out.payload.length} B, ${plan.out.partRows.length} part rows, parts ${JSON.stringify(partBytes)}, counts ${JSON.stringify(man.counts)}`);
console.log(`  PREPARE node data ~${MB(total)}: round-1 reads ${MB(reads1)}, VPprep in ${MB(prepIn)} / out ${MB(size(prep.out))}, round-2 reads ${MB(reads2)}, VPplan in ${MB(planIn)} / out ${MB(size(plan.out))}`);
console.log(`  SUBMIT gate: reads ${MB(size(gateS.hdr) + size(gateS.lines) + size(gateS.movs))}, in ${MB(req(gateCtx))} / out ${size(gate.out)} B`);
process.exit(gate.out.route === "GO" ? 0 : 1);
