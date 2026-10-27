// Picking V2 1c simulator: the two sub-workflows the move calls, stood in by wrapping e.run.
// - GD_REPLAN: what GOODS_DELIVERY's re-save plans for one GD, from the sim's own reservations (bay: the reserved stock and
//   its reservation follow to the bay bin; swap: released at the source, allocated at the target; pending: an SO Pending
//   reservation at the target is taken, no stock moves). The real planner is proven by test_replan_parity.js.
// - INVENTORY_BULK_APPLY: the real guard (scratchpad/gdc/iba/code/guard.js) on every call, then PLAN / APPLY on db.t.bal
//   (all-or-nothing; IBA|I|001 + IBA|DONE rows under the operation key; a DONE operation answers REPLAYED), with faults.
const fs = require("fs");
const path = require("path");

const GUARD_SRC = fs.readFileSync(path.join(__dirname, "..", "..", "gdc", "iba", "code", "guard.js"), "utf8");
const bulkGuard = new Function(GUARD_SRC.slice(0, GUARD_SRC.lastIndexOf("return bulkGuard(")) + "\nreturn bulkGuard;")();
const RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const dec = (v) => (v === undefined || v === null ? null : q8(v).toFixed(8));
// a reservation as a SQL read returns it (decimals as 8-dp text)
const asRead = (r) => {
  const x = {};
  for (const c of RES_COLS) x[c] = r[c] === undefined ? null : ["reserved_qty", "open_qty", "delivered_qty"].includes(c) ? dec(r[c]) : r[c] === null ? null : String(r[c]);
  return x;
};

function replanStub(db, p, opt) {
  const gdId = String(p.gd_id);
  const gd = db.t.gd.find((g) => g.id === gdId) || {};
  const out = { route: "PLANNED", code: "200", message: "", gd_id: gdId, gd_no: gd.delivery_no || "", movements: [], res_updates: [], res_creates: [], gdl_patches: [], gdl_inserts: 0,
    gdl_deletes: 0, gdh_cells: {}, reorder: [], line_count: db.t.gdl.filter((l) => l.goods_delivery_id === gdId && !l.is_deleted).length };
  const o = (opt || {})[gdId] || {};
  if (o.answer) return Object.assign(out, o.answer);
  const bay = Number(p.is_loading_bay) === 1;
  let n = 0;
  const mv = (gl, loc, bat, q, x) => Object.assign({ plant_id: String(gd.plant_id), organization_id: String(gd.organization_id), material_id: String(gl.material_id), quantity: q,
    material_uom: gl.good_delivery_uom_id || null, transaction_type: "GDL", trx_no: gd.delivery_no, parent_trx_no: gl.line_so_no || null, location_id: loc, batch_id: bat || null,
    doc_date: gd.delivery_date || null, handling_unit_id: "" }, x);
  for (const ln of JSON.parse(p.lines || "[]")) {
    const gl = db.t.gdl.find((x) => x.id === String(ln.id));
    if (!gl) return Object.assign(out, { route: "STOP", code: "GR_LINE_NOT_FOUND", message: "line " + ln.id + " is not on " + gd.delivery_no });
    out.gdl_patches.push({ id: gl.id, cells: { temp_qty_data: ln.cells.temp_qty_data, prev_temp_qty_data: ln.cells.temp_qty_data, view_stock: ln.cells.view_stock,
      picking_status: ln.cells.picking_status } });
    const key = (x) => String(x.location_id) + "|" + (x.batch_id ? String(x.batch_id) : "");
    const sum = (a) => a.reduce((m, x) => Object.assign(m, { [key(x)]: q8((m[key(x)] || 0) + Number(x.gd_quantity)) }), {});
    const B = sum(JSON.parse(ln.cells.prev_temp_qty_data || "[]"));
    const A = sum(JSON.parse(ln.cells.temp_qty_data || "[]"));
    const outs = Object.keys(B).filter((k) => q8(B[k] - (A[k] || 0)) > 0).map((k) => [k, q8(B[k] - (A[k] || 0))]);
    const ins = Object.keys(A).filter((k) => q8(A[k] - (B[k] || 0)) > 0).map((k) => [k, q8(A[k] - (B[k] || 0))]);
    for (const [ok, oq] of outs) {
      const [loc, bat] = ok.split("|");
      const src = db.t.res.find((r) => !r.is_deleted && r.status === "Allocated" && r.target_gd_id === gdId && r.doc_line_id === gl.id && String(r.bin_location) === loc
        && String(r.batch_id || "") === bat);
      if (!src) return Object.assign(out, { route: "STOP", code: "GR_TEST", message: "no Allocated reservation of line " + gl.id + " at " + ok });
      const left = q8(Number(src.open_qty) - oq);
      const after = Object.assign(asRead(src), left > 0 ? { reserved_qty: q8(Number(src.reserved_qty) - oq), open_qty: left } : { status: o.pending ? "Pending" : "Cancelled", open_qty: o.pending ? oq : 0 });
      if (o.pending && left <= 0) Object.assign(after, { target_gd_id: null, doc_id: null, doc_no: null, doc_line_id: null, source_reserved_id: src.source_reserved_id || src.id });
      out.res_updates.push({ id: src.id, before: asRead(src), after: after });
      if (!bay && !o.pending) {
        const k = "M" + ++n;
        out.movements.push(mv(gl, loc, bat, oq, { movement_key: k, direction: "SUBTRACT", inventory_category: "Reserved", isMovingInv: 1 }));
        out.movements.push(mv(gl, loc, bat, oq, { movement_key: k + ".2", direction: "ADD", inventory_category: "Unrestricted", isMovingInv: 1, unit_price_from: k }));
      } else if (bay) out.movements.push(mv(gl, loc, bat, oq, { movement_key: "M" + ++n, direction: "SUBTRACT", inventory_category: "Reserved", isMovingInv: 1 }));
    }
    for (const [ik, iq] of ins) {
      const [loc, bat] = ik.split("|");
      const src = db.t.res.find((r) => r.doc_line_id === gl.id && r.target_gd_id === gdId) || {};
      if (o.pending) {
        const pend = db.t.res.find((r) => !r.is_deleted && r.status === "Pending" && r.parent_line_id === src.parent_line_id && String(r.bin_location) === loc && String(r.batch_id || "") === bat);
        if (!pend) return Object.assign(out, { route: "STOP", code: "GR_TEST", message: "no Pending reservation at " + ik });
        out.res_updates.push({ id: pend.id, before: asRead(pend), after: Object.assign(asRead(pend), { status: "Allocated", target_gd_id: gdId, doc_id: gdId, doc_no: gd.delivery_no,
          doc_line_id: gl.id, reserved_qty: iq, open_qty: iq }) });
        continue;
      }
      if (bay) out.movements.push(mv(gl, loc, bat, iq, { movement_key: "M" + ++n, direction: "ADD", inventory_category: "Reserved", isMovingInv: 1 }));
      else {
        const k = "M" + ++n;
        out.movements.push(mv(gl, loc, bat, iq, { movement_key: k, direction: "SUBTRACT", inventory_category: "Unrestricted", isMovingInv: 1 }));
        out.movements.push(mv(gl, loc, bat, iq, { movement_key: k + ".2", direction: "ADD", inventory_category: "Reserved", isMovingInv: 1, unit_price_from: k }));
      }
      out.res_creates.push({ doc_type: src.doc_type || "Good Delivery", status: "Allocated", parent_id: src.parent_id || null, parent_line_id: src.parent_line_id || null,
        parent_no: src.parent_no || null, doc_no: gd.delivery_no, doc_id: gdId, doc_line_id: gl.id, material_id: String(gl.material_id), item_code: String(gl.material_id),
        item_name: gl.material_name || null, item_desc: null, batch_id: bat || null, bin_location: loc, item_uom: src.item_uom || null, reserved_qty: iq, delivered_qty: 0, open_qty: iq,
        reserved_date: gd.delivery_date || null, line_no: src.line_no || null, plant_id: String(gd.plant_id), organization_id: String(gd.organization_id), remark: null, target_gd_id: gdId,
        source_reserved_id: src.id ? src.source_reserved_id || src.id : null, handling_unit_id: null });
    }
  }
  // another GD's reservation planned here too (two GDs sharing one reservation)
  for (const id of o.alsoUpdate || []) {
    const r = db.t.res.find((x) => x.id === id);
    out.res_updates.push({ id: id, before: asRead(r), after: Object.assign(asRead(r), { status: "Cancelled" }) });
  }
  out.message = "Planned " + out.movements.length + " movements, " + out.res_updates.length + " reservation updates, " + out.res_creates.length + " creates for " + out.gd_no;
  return out;
}

function ibaStub(db, p, st) {
  const g = bulkGuard({ mode: p.mode, operationKey: p.operation_key, organizationId: p.organization_id, movements: p.movements, tenantId: db.tenantId, uuid: "0123456789abcdef" });
  st.calls.push({ mode: String(p.mode), op: String(p.operation_key), n: g.count || 0, route: g.route });
  if (g.route !== "GO") return { code: "400", result_code: g.result_code, message: g.result_message };
  const op = g.operationKey;
  const has = (name) => db.t.step.some((x) => x.job_id === op && x.step_name === name);
  if (g.mode === "APPLY" && has("IBA|DONE")) return { code: "200", result_code: "REPLAYED", message: "Already applied" };
  if (g.mode === "APPLY" && st.lockBusy > 0) {
    st.lockBusy--;
    if (st.intentOnBusy && !has("IBA|I|001")) db.insert("GD Publish Step", [{ job_id: op, organization_id: g.organizationId, step_name: "IBA|I|001", step_status: "INTENT", attempt_count: 1, result_ref: "{}" }]);
    return { code: "409", result_code: "LOCK_BUSY", message: "the balance locks are held by another operation" };
  }
  const list = typeof p.movements === "string" ? JSON.parse(p.movements) : p.movements;
  const bal = JSON.parse(JSON.stringify(db.t.bal || {}));
  for (const m of list) {
    const k = String(m.material_id) + "|" + String(m.location_id) + "|" + (m.batch_id ? String(m.batch_id) : "");
    const row = bal[k] || (bal[k] = { Unrestricted: 0, Reserved: 0 });
    const q = q8(m.quantity);
    if (m.direction === "SUBTRACT") {
      if (q8(row[m.inventory_category]) + 1e-9 < q) return { code: "400", result_code: "INSUFFICIENT", message: "Insufficient quantity (movement " + m.movement_key + ")" };
      row[m.inventory_category] = q8(row[m.inventory_category] - q);
    } else row[m.inventory_category] = q8(row[m.inventory_category] + q);
  }
  if (g.mode === "PLAN") return { code: "200", result_code: "OK", message: "Planned " + list.length + " movements" };
  if (!has("IBA|I|001")) db.insert("GD Publish Step", [{ job_id: op, organization_id: g.organizationId, step_name: "IBA|I|001", step_status: "INTENT", attempt_count: 1, result_ref: "{}" }]);
  db.t.bal = bal;
  db.insert("GD Publish Step", [{ job_id: op, organization_id: g.organizationId, step_name: "IBA|DONE", step_status: "DONE", attempt_count: 1, result_ref: "{}" }]);
  st.applied++;
  if (st.crashAfterApply > 0) {
    st.crashAfterApply--;
    throw new Error("injected crash after INVENTORY_BULK_APPLY applied");
  }
  return { code: "200", result_code: "OK", message: "Applied " + list.length + " movements" };
}

const dropNulls = (x) => (Array.isArray(x) ? x.map(dropNulls) : x && typeof x === "object"
  ? Object.keys(x).reduce((o, k) => (x[k] === null ? o : Object.assign(o, { [k]: dropNulls(x[k]) })), {}) : x);

// wraps e.run: GD_REPLAN and INVENTORY_BULK_APPLY answered here; st holds the fault switches and what was called
function install(e) {
  const st = { calls: [], applied: 0, lockBusy: 0, intentOnBusy: false, crashAfterApply: 0, replan: {}, replanCalls: 0, replanBytes: 0, keepNulls: !!process.env.KEEP_NULLS };
  const run0 = e.run.bind(e);
  e.run = (name, params) => {
    if (name === "GD_REPLAN") {
      st.replanCalls++;
      // the platform's run answer leaves out null-valued keys (seen on the deployed GD_REPLAN, 2026-10-16)
      const r = st.keepNulls ? replanStub(e.db, params, st.replan) : dropNulls(replanStub(e.db, params, st.replan));
      st.replanBytes = Math.max(st.replanBytes, JSON.stringify(r).length);
      return { returned: r, ctx: { bytes: 0 } };
    }
    if (name === "INVENTORY_BULK_APPLY") return { returned: ibaStub(e.db, params, st), ctx: { bytes: 0 } };
    if (name === "GD_COMPLETE_SUBMIT") return { returned: gdCompleteStub(e.db, params, st), ctx: { bytes: 0 } };
    return run0(name, params);
  };
  return st;
}

// GD_COMPLETE_SUBMIT as GD Complete V2 answers a Picking's request (stage 1e): STOP for a GD not Created, BUSY on its own open
// completion ("already being completed") or on an open CONFIRM_PICKING of one of its Pickings, else QUEUED + the job, GD Processing
function gdCompleteStub(db, params, st) {
  const S = (v) => (v === undefined || v === null ? "" : String(v));
  st.gdComplete = st.gdComplete || [];
  st.gdComplete.push(JSON.parse(JSON.stringify(params)));
  if (st.gdCompleteCrash > 0) {
    st.gdCompleteCrash--;
    throw new Error("injected GD_COMPLETE_SUBMIT failure (the LOCK insert of a twin request)");
  }
  const gd = db.t.gd.find((g) => g.id === String(params.gd_id) && !g.is_deleted);
  if (!gd) return { route: "STOP", code: "400", message: "Goods Delivery not found", job_id: "" };
  const OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_GD", "REQUIRES_REVIEW"];
  const own = db.t.job.find((j) => !j.is_deleted && j.command === "COMPLETE_GD" && j.correlation_id === "GD|" + gd.id && OPEN.includes(j.job_status));
  if (own) return { route: "BUSY", code: "409", message: "This delivery is already being completed", job_id: own.id };
  if (gd.gd_status !== "Created") return { route: "STOP", code: "400", message: "the Goods Delivery is " + gd.gd_status, job_id: "" };
  const picks = new Set(db.t.lines.filter((l) => S(l.gd_id) === gd.id && !l.is_deleted && (l.line_status || "") !== "Cancelled").map((l) => l.transfer_order_id));
  const confirming = db.t.job.find((j) => !j.is_deleted && j.command === "CONFIRM_PICKING" && picks.has(j.picking_id) && !["COMPLETED", "FAILED", "CANCELLED"].includes(j.job_status));
  if (confirming) return { route: "BUSY", code: "409", message: "Its Picking is being confirmed", job_id: "" };
  const id = String(9300000000000000000n + BigInt(st.gdComplete.length));
  db.t.job.push({ id: id, command: "COMPLETE_GD", job_status: "QUEUED", correlation_id: "GD|" + gd.id, causation_id: params.causation_id, organization_id: gd.organization_id, is_deleted: 0 });
  gd.gd_status = "Processing";
  return { route: "QUEUED", code: "200", message: "queued", job_id: id, job_status: "QUEUED" };
}

// SUBMIT's 1c stage switches set to on / off, whatever the file ships
function switches(e, on) {
  const load0 = e.load.bind(e);
  const ON = "LOADING_BAY: true, BIN_MOVES: true";
  const OFF = "LOADING_BAY: false, BIN_MOVES: false";
  e.load = (name) => {
    const doc = load0(name);
    if (name !== "PICKING_ASYNC_SUBMIT") return doc;
    const find = (lst) => { for (const n of lst || []) { if (n.id === "code_node_PSdecide") return n; const r = find(n.blocks); if (r) return r; } return null; };
    const n = find(doc.nodes);
    const code = n.data.script.code;
    if (code.indexOf(ON) < 0 && code.indexOf(OFF) < 0) throw new Error("the SUBMIT switches are not where the sim expects them");
    n.data.script.code = on ? code.replace(OFF, ON) : code.replace(ON, OFF);
    return doc;
  };
}
const switchesOn = (e) => switches(e, true);

module.exports = { install, switches, switchesOn, replanStub, ibaStub, bulkGuard };
