// GR_REVERT_PREPARE - Plan (code_node_VPplan): grRvPrep's outputs (code_node_VPprep, handed on as grRvPrep's went to
// grRvBuild) + the receipt's documents (round 1) + grRvBuild's reads (round 2) -> grRvBuild (lifted; the five reads it
// caps at 1,000 rows are handed on uncapped, so its fetch_truncated check never fires) -> FAIL with the classic's answer (a
// refusal: GRV_400; conflicts: GRV_STALE, the classic's 409 message + the conflicts in errorDetails), or the manifest COMMIT
// works from: a header (gd_async_job.prepared_payload) and five parts as gd_publish_step rows P|<nonce>|<PART>|<nnn>
// (400,000-char chunks):
//   ENGINE { operation_key GRV|<job>, movements: one GRN-R SUBTRACT (isMovingInv 1) per grRvBuild subtract, in its order }
//   COST   { fifo [{ id, material_id, initial, available }], waDelete [{ id, material_id, wa_quantity, wa_cost_price }] as read,
//            waRestate [{ id, material_id, B, C }]: B / C over EVERY live row of the item (grRvBuild's sums) }
//   DOCS   { putaway [id], transit [{ id, status, open_qty }], qi [id], batches [id] }
//   PO     { poLines [{ id, po_id, recv, res }], onOrder [{ po_line_id, base }], poIds }: grRvBuild section 9's per-line sums
//   CHECK  { anchors, minLiveId, itemIds, plantId, names, transit / putaway as read }: what R0 re-checks on fresh rows
// Every derived figure is checked against what grRvBuild wrote from the same rows (GRV_PLAN_BROKEN when they disagree).
const RV_PARTS = ["ENGINE", "COST", "DOCS", "PO", "CHECK"];
const RV_CHUNK = 400000;
const RV_MAX_MOVEMENTS = 5000;
const RV_STALE = "Revert blocked: this receipt's stock has been used or its documents have moved on.";
// GRsaveWorkflow's row routing, as grRvBuild section 9 applies it
const rvIsSplitParent = (r) => r.is_split === "Yes" && r.parent_or_child === "Parent";
const rvIsChild = (r) => r.parent_or_child === "Child";
const rvSkipInventory = (r) => (!r.item_id || rvIsSplitParent(r) ? 1 : 0);
const rvUpdatesPOLine = (r) => (rvIsChild(r) ? 0 : 1);
const rvUpdatesOnOrder = (r) =>
  rvIsSplitParent(r) || (!rvIsSplitParent(r) && !rvIsChild(r) && rvSkipInventory(r) === 0) ? 1 : 0;
const rvQtyStr = (v) => Math.max(0, rvQ8(v)).toFixed(8);
// a part's JSON text in rows of at most `size` characters, never splitting a surrogate pair; at least one row
const rvChunks = (text, size) => {
  const out = [];
  for (let at = 0; at < text.length || !out.length; ) {
    let end = Math.min(text.length, at + size);
    if (end < text.length && /[\udc00-\udfff]/.test(text[end])) end--;
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
};

const rvPlan = function rvPlan(entry, prep, S, opts) {
  const o = opts || {};
  const e = entry || {};
  const p = prep || {};
  const req = e.request && typeof e.request === "object" ? e.request : {};
  const prev = rvS(req.previousStatus);
  const base = { route: "FAIL", code: "", message: "", payload: "", partRows: [], lineCount: Number(p.lineCount) || 0, movementCount: 0, unlockOk: 0,
    previousStatus: prev, errorDetails: "" };
  const fail = (code, message, details) => Object.assign(base, { route: "FAIL", code: code, message: message, errorDetails: details ? JSON.stringify(details) : "" });
  if (rvS(e.route) !== "GO") return fail(rvS(e.result_code) || "GRV_INVALID_REQUEST", rvS(e.result_message) || "the job's request could not be read");
  if (rvS(p.route) !== "GO") {
    base.unlockOk = Number(p.unlockOk) === 1 ? 1 : 0;
    return fail(rvS(p.code) || "GRV_INVALID_DATA", rvS(p.message) || "the receipt could not be prepared");
  }
  // VPprep answered GO: the receipt is Processing under this job and nothing was written, so a failure unlocks it
  base.unlockOk = 1;
  if (Number(p.refuse) === 1) return fail("GRV_400", rvS(p.refuseMessage));
  const jobId = rvS(e.jobId);
  const grNo = rvS(p.grNo);
  const org = rvS(p.organizationId);
  const plant = rvS(p.plantId);
  if (!rvDigits(jobId) || !rvDigits(p.grId) || !rvDigits(org) || !rvDigits(plant) || !grNo) return fail("GRV_INVALID_DATA", "the prepared receipt has no valid id, number, organization or plant");
  const A1 = rvAdapt1(S);
  const A2 = rvAdapt2(S);
  const lines = rvList(p.lines);
  const lineItems = {};
  for (const l of lines) if (rvS(l.item_id)) lineItems[rvS(l.item_id)] = 1;
  if (rvHasHu(p)) return fail("GRV_NOT_ELIGIBLE", "it has handling units: revert it with the classic revert");
  if (A2.items.data.some((it) => lineItems[rvS(it.id)] && Number(it.serial_number_management) === 1)) return fail("GRV_NOT_ELIGIBLE", "it has serial-numbered items: revert it with the classic revert");

  // grRvBuild on GR_REVERT_COMPLETED's inputs: grRvPrep's declared outputs, the search nodes' {total,count,data}, the sql-nodes' rows
  const ctx = {};
  const prepData = {};
  for (const [name] of __N["code_node_grRvPrep"].decl) if (p[name] !== undefined && p[name] !== null) prepData[name] = p[name];
  ctx["node:code_node_grRvPrep"] = { data: prepData };
  const put = (id, rows, uncapped) => {
    ctx["node:" + id] = { data: { total: rows.length, count: rows.length, data: uncapped ? new __Uncapped(rows) : rows } };
  };
  put("search_node_grRvPutaway", A1.putaway.data);
  put("search_node_grRvQi", A1.qi.data);
  put("search_node_grRvTransit", A1.transit.data, true);
  put("search_node_grRvBatch", A1.batches.data);
  put("search_node_grRvPi", A2.pi.data);
  put("search_node_grRvBatchBal", A2.bbal.data, true);
  put("search_node_grRvItemBal", A2.ibal.data, true);
  put("search_node_grRvHu", A2.hu.data);
  put("search_node_grRvPo", A2.po.data);
  put("search_node_grRvOnOrder", A2.oo.data, true);
  put("search_node_grRvItems", A2.items.data, true);
  ctx["node:sql_node_grRvLater"] = { data: A2.later };
  ctx["node:sql_node_grRvFifo"] = { data: A2.fifo };
  ctx["node:sql_node_grRvWa"] = { data: A2.wa };
  ctx["node:sql_node_grRvCostCounts"] = { data: A2.costcounts };
  const b = __withContext(ctx, () => __run("code_node_grRvBuild"));
  if (o.debug) Object.defineProperty(base, "__build", { value: b, enumerable: false });
  if (Number(b.hasConflicts) === 1) {
    const c = rvList(b.conflicts);
    const why = RV_STALE + " " + c.slice(0, 5).map((x) => rvS(x.message)).join(" ") + (c.length > 5 ? " (+" + (c.length - 5) + " more)" : "");
    return fail("GRV_STALE", why.slice(0, 1000), { step: "GR_REVERT_PREPARE", conflicts: c });
  }

  // ENGINE: GR_REVERT_COMPLETED's SUBTRACT_INVENTORY parameters per subtract (itemData / index aside, no handling unit)
  const subs = rvList(b.subtracts);
  if (subs.length > RV_MAX_MOVEMENTS) return fail("GRV_TOO_LARGE", subs.length + " stock movements, more than one revert carries (" + RV_MAX_MOVEMENTS + ")");
  const movements = [];
  for (let i = 0; i < subs.length; i++) {
    const x = subs[i];
    const m = {
      movement_key: "R" + (i + 1), direction: "SUBTRACT", plant_id: plant, organization_id: org, material_id: rvS(x.material_id), quantity: x.quantity,
      material_uom: rvS(x.material_uom), unit_price: x.unit_price, transaction_type: "GRN-R", trx_no: grNo, parent_trx_no: rvS(x.parent_trx_no),
      inventory_category: rvS(x.inventory_category), location_id: rvS(x.location_id), batch_id: rvS(x.batch_id) || null, handling_unit_id: null,
      doc_date: rvS(x.doc_date), isMovingInv: 1,
    };
    const bad = !rvDigits(m.material_id) ? "item" : !rvDigits(m.location_id) ? "bin location" : m.batch_id !== null && !rvDigits(m.batch_id) ? "batch"
      : !(rvNum(m.quantity) > 0) ? "quantity" : !m.inventory_category ? "inventory category" : rvNum(m.unit_price) < 0 ? "unit price" : "";
    if (bad) return fail("GRV_INVALID_DATA", rvS(x.failLabel) + ": the reversal has no valid " + bad);
    movements.push(m);
  }

  // COST: the rows grRvBuild matched, as read; the non-batch weighted average restated from B / C over every live row of the
  // item (its sums, in its order), checked against the restate it computed from the same row
  const fifoBy = {};
  for (const f of A2.fifo) fifoBy[rvS(f.id)] = f;
  const waBy = {};
  for (const w of A2.wa) waBy[rvS(w.id)] = w;
  const live = rvList(p.liveRows).slice().sort((a, c) => rvCmpId(a.id, c.id));
  const fifo = [];
  const waDelete = [];
  const waRestate = [];
  const seen = {};
  for (const x of subs) {
    if (Number(x.hasFifoDelete) === 1 && !seen["F" + x.fifoDeleteId]) {
      const f = fifoBy[rvS(x.fifoDeleteId)];
      if (!f) return fail("GRV_PLAN_BROKEN", "FIFO layer " + rvS(x.fifoDeleteId) + " was not read");
      seen["F" + x.fifoDeleteId] = 1;
      fifo.push({ id: rvS(f.id), material_id: rvS(x.material_id), initial: f.fifo_initial_quantity, available: f.fifo_available_quantity });
    }
    if (Number(x.hasWaDelete) === 1 && !seen["W" + x.waDeleteId]) {
      const w = waBy[rvS(x.waDeleteId)];
      if (!w) return fail("GRV_PLAN_BROKEN", "weighted-average row " + rvS(x.waDeleteId) + " was not read");
      seen["W" + x.waDeleteId] = 1;
      waDelete.push({ id: rvS(w.id), material_id: rvS(x.material_id), wa_quantity: w.wa_quantity, wa_cost_price: w.wa_cost_price });
    }
    if (Number(x.hasWaUpdate) === 1) {
      const w = waBy[rvS(x.waUpdateId)];
      const rows = live.filter((r) => rvS(r.item_id) === rvS(x.material_id) && !rvS(r.batch_number_id));
      let B = 0;
      let C = 0;
      for (const r of rows) {
        B = rvQ8(B + rvNum(r.base_qty));
        C = C + rvNum(r.base_qty) * rvNum(r.unit_price);
      }
      const q1 = w ? rvNum(w.wa_quantity) : 0;
      const p1 = w ? rvNum(w.wa_cost_price) : 0;
      const q0 = rvQ8(q1 - B);
      const p0 = q0 > 0.0005 ? rvQ8((p1 * q1 - C) / q0) : p1;
      if (!w || !rows.length || x.waQuantity !== (q0 > 0.0005 ? rvQtyStr(q0) : "0.00000000") || x.waCostPrice !== rvQtyStr(p0)) {
        return fail("GRV_PLAN_BROKEN", "the weighted-average restate of item " + rvS(x.material_id) + " does not follow from its live rows");
      }
      waRestate.push({ id: rvS(x.waUpdateId), material_id: rvS(x.material_id), B: B, C: C });
    }
  }

  // DOCS: grRvBuild's lists
  const docs = {
    putaway: rvList(b.putawayDeletes).map((x) => rvS(x.id)), transit: rvList(b.transitUpdates).map((t) => ({ id: rvS(t.id), status: rvS(t.status), open_qty: rvS(t.open_qty) })),
    qi: rvList(b.qiDeletes).map((x) => rvS(x.id)), batches: rvList(b.batchDeletes).map((x) => rvS(x.id)),
  };

  // PO: section 9's per-line sums over grRvPrep's lines; applied to the lines / on-order rows as read they must give grRvBuild's writes
  const recv = {};
  const res = {};
  const baseQ = {};
  const ooLines = [];
  for (const l of lines) {
    const lid = rvS(l.po_line_item_id);
    if (!lid) continue;
    if (rvUpdatesPOLine(l) === 1) recv[lid] = rvQ8((recv[lid] || 0) + rvNum(l.received_qty));
    if (rvUpdatesOnOrder(l) === 1) {
      if (baseQ[lid] === undefined) ooLines.push(lid);
      baseQ[lid] = rvQ8((baseQ[lid] || 0) + (rvNum(l.base_received_qty) || rvNum(l.received_qty)));
    }
    if (!rvIsSplitParent(l)) res[lid] = rvQ8((res[lid] || 0) + rvNum(l.received_qty));
  }
  const polBy = {};
  const poOf = {};
  const flat = (rows) => rvList(rows).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
  for (const po of A2.po.data) for (const pl of flat(po.table_po)) {
    polBy[rvS(pl.id)] = pl;
    poOf[rvS(pl.id)] = rvS(po.id);
  }
  const poLines = [];
  for (const u of rvList(b.poLineUpdates)) {
    const lid = rvS(u.id);
    const pl = polBy[lid];
    const r = recv[lid];
    if (!pl || r === undefined) return fail("GRV_PLAN_BROKEN", "purchase order line " + lid + " has no receipt quantity");
    const rs = res[lid] || 0;
    const quantity = rvNum(pl.quantity);
    const newRecv = Math.max(0, rvQ8(rvNum(pl.received_qty) - r));
    const cur = rvS(pl.line_status);
    const st = cur === "Cancelled" || cur === "Draft" ? cur : quantity > 0 && newRecv >= quantity - 0.005 ? "Completed" : newRecv > 0.005 ? "Processing" : "Issued";
    if (u.received_qty !== rvQtyStr(newRecv) || u.outstanding_quantity !== rvQtyStr(Math.max(0, rvQ8(quantity - newRecv))) || u.line_status !== st
      || u.created_received_qty !== rvQtyStr(rvNum(pl.created_received_qty) + rs)) {
      return fail("GRV_PLAN_BROKEN", "purchase order line " + lid + ": the receipt quantities do not give the revert's figures");
    }
    poLines.push({ id: lid, po_id: poOf[lid], recv: r, res: rs });
  }
  const ooBy = {};
  for (const oo of A2.oo.data) ooBy[rvS(oo.id)] = oo;
  for (const u of rvList(b.onOrderUpdates)) {
    const oo = ooBy[rvS(u.id)];
    const bq = oo ? baseQ[rvS(oo.po_line_id)] : undefined;
    const newRecv = Math.max(0, rvQ8(rvNum(oo && oo.received_qty) - (bq || 0)));
    if (!oo || bq === undefined || u.received_qty !== rvQtyStr(newRecv) || u.open_qty !== rvQtyStr(Math.max(0, rvQ8(rvNum(oo.scheduled_qty) - newRecv)))) {
      return fail("GRV_PLAN_BROKEN", "on-order row " + rvS(u.id) + ": the receipt's base quantity does not give the revert's figures");
    }
  }
  const onOrder = ooLines.map((lid) => ({ po_line_id: lid, base: baseQ[lid] }));
  const poIds = A2.po.data.map((x) => rvS(x.id)).filter(rvDigits).sort(rvCmpId);

  // CHECK: the later-movement anchors, the items (with the names its messages use), the documents as read
  const itemBy = {};
  for (const it of A2.items.data) itemBy[rvS(it.id)] = it;
  const names = {};
  for (const r of live) {
    const id = rvS(r.item_id);
    const it = itemBy[id];
    names[id] = (it && (it.material_code || it.material_name)) || id;
  }
  const itBy = {};
  for (const t of A1.transit.data) itBy[rvS(t.id)] = t;
  const toBy = {};
  for (const t of A1.putaway.data) toBy[rvS(t.id)] = t;
  const asRead = (row, cols) => {
    const out = {};
    for (const c of cols) out[c] = row && row[c] !== undefined ? row[c] : null;
    return out;
  };
  const check = {
    anchors: p.tupleAnchors && typeof p.tupleAnchors === "object" ? p.tupleAnchors : {}, minLiveId: rvS(p.minLiveIdSql),
    itemIds: rvList(p.itemIds).map(rvS).filter(rvDigits), plantId: plant, names: names,
    transit: docs.transit.map((t) => Object.assign({ id: t.id }, asRead(itBy[t.id], ["status", "open_qty", "transit_qty"]))),
    putaway: docs.putaway.map((id) => Object.assign({ id: id }, asRead(toBy[id], ["to_status", "is_processing"]))),
  };

  const parts = { ENGINE: { operation_key: "GRV|" + jobId, movements: movements }, COST: { fifo: fifo, waDelete: waDelete, waRestate: waRestate }, DOCS: docs,
    PO: { poLines: poLines, onOrder: onOrder, poIds: poIds }, CHECK: check };
  const nonce = (rvS(e.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const partRows = [];
  const manifestParts = {};
  for (const name of RV_PARTS) {
    manifestParts[name] = rvChunks(JSON.stringify(parts[name]), RV_CHUNK).map((chunk, i) => {
      const step = "P|" + nonce + "|" + name + "|" + String(i + 1).padStart(3, "0");
      partRows.push({ job_id: jobId, organization_id: org, step_name: step, step_status: "PAYLOAD", attempt_count: 0, result_ref: chunk });
      return step;
    });
  }
  const manifest = {
    v: 1, job_id: jobId, gr_id: rvS(p.grId), gr_no: grNo, organization_id: org, plant_id: plant, previous_status: prev, nonce: nonce, po_ids: poIds, parts: manifestParts,
    counts: { lines: lines.length, movements: movements.length, fifo: fifo.length, waDelete: waDelete.length, waRestate: waRestate.length, putaway: docs.putaway.length,
      transit: docs.transit.length, qi: docs.qi.length, batches: docs.batches.length, poLines: poLines.length, onOrder: onOrder.length },
  };
  if (o.debug) Object.defineProperty(base, "__parts", { value: parts, enumerable: false });
  return Object.assign(base, { route: "READY", code: "200", message: "Planned " + movements.length + " movements for " + lines.length + " lines", payload: JSON.stringify(manifest),
    partRows: partRows, lineCount: lines.length, movementCount: movements.length });
};
