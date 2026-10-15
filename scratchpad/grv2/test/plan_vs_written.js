// Harness (c): plan.js (the whole PREPARE plan) on each recorded completion's own inputs - the GR as SUBMIT would have
// stored it (the run's read-back: Processing, auto-numbered lines still "Auto-generated batch number"), the reads it
// recorded, the batch configs its GENERATE_BATCH calls read, the reservation map code_node_origReserved recorded - and the
// manifest's Putaway (TO header + lines) and in-transit rows against the rows that completion wrote (fetch_written.py),
// static columns only. A batch C1 creates (batch_ref) maps to the batch the old ADD_INVENTORY created; target_doc_id /
// target_doc_no are C4's (filled from the TO it adds) and are checked against the written TO.
// usage: TZ=Asia/Kuala_Lumpur node plan_vs_written.js <fixtures.jsonl> <written.json> [<fixtures.jsonl> <written.json> ...]
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const { planSandbox } = require("./plan_live.js");
if (new Date(2026, 0, 1).getTimezoneOffset() !== -480) {
  console.error("run with TZ=Asia/Kuala_Lumpur (UTC+8), as the platform does");
  process.exit(2);
}
const D = path.join(__dirname, "..");
const BIG = /"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g;
const P = (t) => JSON.parse(String(t).replace(BIG, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const src = {};
(function walk(o) {
  if (Array.isArray(o)) o.forEach(walk);
  else if (o && typeof o === "object") {
    if (o.type === "code-node" && o.data && o.data.script) src[o.id] = o.data.script.code;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(path.join(D, "..", "..", "Goods Receiving", "GRsaveWorkflow.json"), "utf8")));
const olderVersion = (r) => Object.entries(r.nodes).some(([id, n]) => n.code !== undefined && src[id] !== undefined && n.code !== src[id]);
const sb = planSandbox(true);
const empty = (v) => v === undefined || v === null || v === "";
const same = (a, b) => {
  if (empty(a) && empty(b)) return true;
  if (empty(a) || empty(b)) return false;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  if (!isNaN(Number(a)) && !isNaN(Number(b)) && String(a).trim() !== "" && String(b).trim() !== "") return Number(a) === Number(b);
  const sa = String(a);
  const sbb = String(b);
  // a date-only value against the stored timestamp
  if (/^\d{4}-\d\d-\d\d$/.test(sa) && sbb.startsWith(sa + " 00:00:00")) return true;
  if (/^\d{4}-\d\d-\d\d$/.test(sbb) && sa.startsWith(sbb + " 00:00:00")) return true;
  return sa === sbb;
};
const TO_HDR = ["plant_id", "to_id_type", "movement_type", "ref_doc_type", "gr_no", "receiving_no", "supplier_id", "created_by", "assigned_to", "created_at", "organization_id", "project_id"];
const TO_LINE = ["line_index", "item_code", "item_name", "item_desc", "batch_no", "source_inv_category", "target_inv_category", "received_qty", "item_uom", "source_bin",
  "qty_to_putaway", "qi_no", "po_no", "parent_index", "unit_price", "total_price", "hu_data", "handling_unit_id", "gr_line_id", "project_id", "item_bundle_id"];
const TO_LINE_LATER = ["storage_location", "target_location", "remark", "pending_process_qty", "putaway_qty", "line_status", "is_split", "parent_or_child"];
const IT_ROW = ["doc_type", "doc_id", "doc_no", "doc_line_id", "line_no", "parent_id", "parent_no", "parent_line_id", "material_id", "item_code", "item_name", "item_desc",
  "item_uom", "batch_id", "handling_unit_id", "plant_id", "organization_id", "transit_bin", "from_plant_id", "from_bin", "from_category", "to_plant_id", "to_category",
  "transit_date", "remark", "target_doc_type", "target_doc_id", "target_doc_no", "source_transit_id"];
const IT_LATER = ["transit_qty", "received_qty", "open_qty", "status", "to_bin", "target_doc_line_id"];
const T = { runs: 0, olderVersion: 0, planned: 0, notPlanned: 0, toHeader: { same: 0, diff: 0 }, toLines: { same: 0, diff: 0, count: 0, laterChanged: 0 },
  itRows: { same: 0, diff: 0, count: 0, laterChanged: 0 }, missingWritten: 0 };
const notes = [];
const args = process.argv.slice(2);
for (let a = 0; a < args.length; a += 2) {
  const written = JSON.parse(fs.readFileSync(args[a + 1], "utf8"));
  for (const line of fs.readFileSync(args[a], "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.exit !== "return_node_coSATlEf") continue;
    if (olderVersion(r)) { T.olderVersion++; continue; }
    const rec = (id) => (r.nodes[id] && r.nodes[id].resp ? r.nodes[id].resp.data : undefined);
    const grId = rec("code_node_UQWzCg37").id;
    const W = written[grId];
    if (!W) { T.missingWritten++; continue; }
    T.runs++;
    const note = (s) => notes.push(`${r.env} ${r.id} (${r.params.pageStatus}): ${s}`);
    // the GR as SUBMIT stores it: the run's read-back, line ids from get_node_ITgrLines (an Add's answer carries none)
    const add = rec("add_node_nGMSu41b");
    const rb = JSON.parse(JSON.stringify(r.params.pageStatus === "Add" ? (add || [])[0] : (rec("get_node_UeM3HpzR") || {}).data));
    const after = (rec("get_node_ITgrLines") || {}).data || {};
    const flat = (rows) => (rows || []).flatMap((x) => [x].concat(Array.isArray(x.children) ? x.children : []));
    const rbFlat = flat(rb.table_gr);
    const afFlat = flat(after.table_gr);
    rbFlat.forEach((x, i) => { if (!x.id && afFlat[i]) x.id = afFlat[i].id; });
    const loopRows = (rec("code_node_4r2Fv9G5") || {}).loopRows || [];
    rbFlat.forEach((x, i) => { if (loopRows[i] && loopRows[i].item_batch_no === "Auto-generated batch number") x.item_batch_no = "Auto-generated batch number"; });
    const storedBefore = r.params.pageStatus === "Edit" ? ((rec("search_origGRMain") || {}).data || [])[0] : null;
    const prev = r.params.pageStatus === "Add" ? "Draft" : (storedBefore && storedBefore.gr_status) || "Draft";
    rb.gr_status = "Processing";
    rb.previous_status = prev;
    // the config rows its GENERATE_BATCH calls read (the first call's view of each), their items
    const gens = (r.gens || []).filter((g) => g.exit === "end").sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
    const bnc = [];
    const bnItems = [];
    for (const g of gens) {
      for (const k of ["get_node_Mx1xwOKd", "get_node_DNJctx3t", "get_node_YX3D4xFA", "get_node_cbX4ILIH"]) {
        const d = g.nodes[k] && g.nodes[k].resp ? g.nodes[k].resp.data : null;
        if (d && d.count && !bnc.find((x) => x.id === d.data.id)) bnc.push(d.data);
      }
      for (const it of (g.nodes.sql_node_GbItem && g.nodes.sql_node_GbItem.resp ? g.nodes.sql_node_GbItem.resp.data : []) || []) if (!bnItems.find((x) => x.id === it.id)) bnItems.push(it);
    }
    const nowGen = gens.length ? Date.parse(((gens[0].nodes.code_node_93lsgfQY || gens[0].nodes.code_node_hs092Lw8 || gens[0].nodes.code_node_9IzMl1j4 || gens[0].nodes.code_node_WgU9WsEM || {}).resp || { data: {} }).data.dateToUse) : NaN;
    const poDocs = rec("search_node_nkWkBdXY") || { total: 0, count: 0, data: [] };
    sb.__adapted = sb.grAdapt({ batches: (W.batches || []).map((j) => ({ j })) });
    const R = {
      gr: { count: 1, data: rb }, lines: rbFlat, items: rec("search_node_BwcLu7r7") || { total: 0, count: 0, data: [] }, poDocs: poDocs,
      poLines: poDocs.data.flatMap((d) => flat(d.table_po)), poHeaders: poDocs.data, onOrder: [],
      putawaySetup: rec("get_node_QBrFrLs9") || { count: 0, data: {} }, loadingBay: rec("get_node_njg7cSUu") || { count: 0, data: {} },
      putawayRule: rec("get_node_xUdzlNqh") || { count: 0, data: {} }, bncRows: bnc, bnItems: bnItems,
      batches: sb.__adapted.batches.filter((b) => BigInt(b.id) < BigInt(r.id)), lock: { step_name: "LOCK|1", result_ref: "K" },
    };
    const entry = { route: "GO", jobId: "2110999999999999999", tenantId: r.tenant, organizationId: String(rb.organization_id), plantId: String(rb.plant_id), grId: grId,
      idempotencyKey: "K", nonce: "abcd1234", previousStatus: prev, request: { v: 1, previousStatus: prev, answers: {}, grNo: rb.gr_no, origReserved: (rec("code_node_origReserved") || {}).origReserved || {} } };
    sb.__args = { entry, R, now: isNaN(nowGen) ? (r.nodes.code_node_jo9g6Ldx && r.nodes.code_node_jo9g6Ldx.t0) || r.t0 : nowGen };
    sb.__setNow((r.nodes.code_node_jo9g6Ldx && r.nodes.code_node_jo9g6Ldx.t0) || (r.nodes.code_node_2Cq2eMRb && r.nodes.code_node_2Cq2eMRb.t0) || r.t0);
    const res = vm.runInContext("grPlan(__args.entry, null, { adapted: __args.R, now: __args.now, debug: true, allowWA: true })", sb);
    if (res.route !== "READY") { T.notPlanned++; note(`${res.code} ${res.message}`); continue; }
    T.planned++;
    // the PO part's deltas, applied as C3 applies them to the PO lines the run read (search_node_nkWkBdXY), against the lines
    // it left (search_node_XqqoMDRs): received_qty, outstanding (clamped), line_status, created_received_qty
    {
      const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
      const beforeL = {};
      for (const d of poDocs.data) for (const l of flat(d.table_po)) beforeL[l.id] = l;
      const afterL = {};
      for (const d of ((rec("search_node_XqqoMDRs") || {}).data || [])) for (const l of flat(d.table_po)) afterL[l.id] = l;
      const fromCreated = res.parts.PO.fromCreated;
      // what the classic released: its own previous_status said so (a stale "Draft" on a Created GR released nothing)
      const classicFromCreated = r.params.allData && r.params.allData.previous_status === "Created";
      T.poDelta = T.poDelta || { same: 0, diff: 0, releaseDiffers: 0 };
      for (const e of res.parts.PO.poLines) {
        const b = beforeL[e.id];
        const a = afterL[e.id];
        if (!b || !a) continue;
        const recv = q8(Number(b.received_qty || 0) + e.delta_received);
        const out = Math.max(0, q8(Number(b.quantity || 0) - recv));
        const status = out <= 0 ? "Completed" : "Processing";
        const created = fromCreated ? Math.max(0, q8(Number(b.created_received_qty || 0) - e.release_created)) : q8(b.created_received_qty || 0);
        const okBase = recv === q8(a.received_qty) && out === q8(a.outstanding_quantity) && status === a.line_status;
        const okCreated = created === q8(a.created_received_qty || 0);
        if (okBase && okCreated) T.poDelta.same++;
        else if (okBase && fromCreated !== classicFromCreated) T.poDelta.releaseDiffers++;
        else { T.poDelta.diff++; note(`PO line ${e.id}: recv ${recv}/${a.received_qty} out ${out}/${a.outstanding_quantity} ${status}/${a.line_status} created ${created}/${a.created_received_qty}`); }
      }
    }
    // batch_ref -> the batch the old add created (movement order = ADD_INVENTORY run order)
    const adds = (r.adds || []).slice().sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
    const refId = {};
    res.parts.ENGINE.movements.forEach((m, k) => { if (m.batch_ref && adds[k] && adds[k].resp && adds[k].resp.data) refId[m.batch_ref] = adds[k].resp.data.batchId; });
    // only rows this completion wrote (ids inside its run window); a TO or ledger row of a later flow is not its
    const lo = BigInt(r.id);
    const hi = BigInt(r.t1 + 3000 - 1288834974657) << 22n;
    const mineRun = (x) => BigInt(x.id) >= lo && BigInt(x.id) <= hi;
    const toW = (W.to || []).map(P).filter(mineRun)[0] || null;
    const toLinesW = toW ? (W.toLines || []).map(P).filter((l) => l.transfer_order_putaway_id === toW.id) : [];
    const itW = (W.it || []).map(P).filter((x) => empty(x.source_transit_id) && mineRun(x));
    // TO header
    const hdr = res.parts.TO.header;
    // a TO the run added but a later revert / delete removed (the run recorded add_node_RTuMAGp5)
    if (hdr && !toW && rec("add_node_RTuMAGp5")) { T.toRemovedSince = (T.toRemovedSince || 0) + 1; continue; }
    if (hdr || toW) {
      if (!hdr || !toW) { T.toHeader.diff++; note(`TO: manifest ${hdr ? "has" : "has no"} TO, written ${toW ? "has" : "has none"}`); }
      else {
        const bad = TO_HDR.filter((c) => !same(hdr[c], toW[c]));
        if (bad.length) { T.toHeader.diff++; note("TO header: " + bad.map((c) => `${c} ${JSON.stringify(hdr[c])} | written ${JSON.stringify(toW[c])}`).join("; ")); }
        else T.toHeader.same++;
      }
    }
    const mLines = flat(res.parts.TO.lines).map((l) => Object.assign({}, l, l.batch_ref ? { batch_no: refId[l.batch_ref] || l.batch_ref } : {}));
    if (mLines.length !== toLinesW.length) note(`TO lines: ${mLines.length} planned | ${toLinesW.length} written`);
    for (let i = 0; i < Math.min(mLines.length, toLinesW.length); i++) {
      T.toLines.count++;
      const bad = TO_LINE.filter((c) => !same(mLines[i][c], toLinesW[i][c]));
      if (TO_LINE_LATER.some((c) => !same(mLines[i][c], toLinesW[i][c]))) T.toLines.laterChanged++;
      if (bad.length) { T.toLines.diff++; note(`TO line ${i}: ` + bad.map((c) => `${c} ${JSON.stringify(mLines[i][c])} | written ${JSON.stringify(toLinesW[i][c])}`).join("; ")); }
      else T.toLines.same++;
    }
    // in-transit rows: C4 stamps the TO it added
    const mIt = res.parts.TO.inTransit.map((x) => Object.assign({}, x, x.batch_ref ? { batch_id: refId[x.batch_ref] || x.batch_ref } : {},
      x.target_doc_type === "Putaway" && toW ? { target_doc_id: toW.id, target_doc_no: toW.to_id } : {}));
    if (mIt.length !== itW.length) note(`in-transit rows: ${mIt.length} planned | ${itW.length} written`);
    for (let i = 0; i < Math.min(mIt.length, itW.length); i++) {
      T.itRows.count++;
      const bad = IT_ROW.filter((c) => !same(mIt[i][c], itW[i][c]));
      if (IT_LATER.some((c) => !same(mIt[i][c], itW[i][c]))) T.itRows.laterChanged++;
      if (bad.length) { T.itRows.diff++; note(`in-transit ${i}: ` + bad.map((c) => `${c} ${JSON.stringify(mIt[i][c])} | written ${JSON.stringify(itW[i][c])}`).join("; ")); }
      else T.itRows.same++;
    }
  }
}
console.log(JSON.stringify(T));
for (const n of notes.slice(0, Number(process.env.SHOW || 40))) console.log("  " + n);
