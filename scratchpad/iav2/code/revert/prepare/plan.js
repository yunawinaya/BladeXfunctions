// IA_REVERT_V2_PREPARE - Plan: lifted params + prep + build -> FAIL, or the manifest and its parts (CONTRACT.md RV6)
const RV_PARTS_ORDER = ["ENGINE", "COST", "BATCH", "HDR", "LABELS"];
const RV_CHUNK = 400000;
const iarvChunks = (text, size) => {
  const out = [];
  for (let at = 0; at < text.length || !out.length; ) {
    let end = Math.min(text.length, at + size);
    if (end < text.length && /[\udc00-\udfff]/.test(text[end])) end--;
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
};
const iarvPlanNode = function iarvPlanNode(entry, prep, S, opts) {
  const o = opts || {};
  const e = entry || {};
  const pr = prep || {};
  const base = { route: "FAIL", code: "", message: "", payload: "", partRows: [], lineCount: Number(pr.liveRows) || 0, movementCount: 0, unlockOk: Number(pr.unlockOk) === 1 ? 1 : 0,
    details: "", needPlan: "NO", operationKey: "", organizationId: iaS(e.organizationId), movements: [], labels: {}, keys: [] };
  const fail = (code, message, details) => Object.assign(base, { route: "FAIL", code: code, message: message,
    details: JSON.stringify(Object.assign({ step: "IA_REVERT_V2_PREPARE" }, details || {})) });
  if (iaS(pr.route) !== "GO") return Object.assign(base, { route: "FAIL", code: iaS(pr.code) || "IA_RV_PLAN_FAILED", message: iaS(pr.message) || "the revert could not be prepared", details: iaS(pr.details) });
  // prep answered GO: the IA is Processing under this job and nothing was written, so a failure unlocks it
  base.unlockOk = 1;
  const jobId = iaS(e.jobId);
  const org = iaS(e.organizationId);
  const hdr = iaRows(S.hdr)[0] || null;
  const moves = iarvSqlRows(S.moves);
  const run = iarvRunPrep(iarvHeaderSeen(hdr, org, e.prevStatus), moves, iarvJRows(S.batch), { iaId: e.iaId, iaNo: iaS(pr.iaNo), organizationId: org });
  const p = run.prep;
  const L = iarvLive(p);
  const fp = iaMovesFingerprint(moves);
  if (Number(p.refuse) === 1 || L.liveRows !== Number(pr.liveRows) || fp !== iaS(pr.movesFingerprint)) {
    return fail("IA_RV_PLAN_BROKEN", "The revert could not be prepared: the Item Assembly's rows differ between the two reads of this run", { live: L.liveRows, prep: pr.liveRows });
  }
  const plant = iaS(p.plantId);
  const iaNo = iaS(p.iaNo);
  const R = { fifo: iarvSqlRows(S.fifo), wa: iarvSqlRows(S.wa), costcounts: iarvSqlRows(S.costcounts), itemBal: iarvJRows(S.itemBal), batchBal: iarvJRows(S.batchBal), items: iarvJRows(S.items) };
  const b = iarvRunBuild(run, R);
  if (o.debug) Object.defineProperty(base, "__build", { value: b, enumerable: false });
  if (Number(b.hasConflicts) === 1) {
    const c = iaList(b.conflicts);
    const why = IA_TEXT.rvConflicts + " " + c.slice(0, 5).map((x) => iaS(x.message)).join(" ") + (c.length > 5 ? " (+" + (c.length - 5) + " more)" : "");
    return fail("IA_RV_CONFLICTS", why.slice(0, 1000), { conflicts: c });
  }
  const itemBy = {};
  for (const it of R.items) itemBy[iaS(it.id)] = it;
  const serial = L.items.filter((id) => itemBy[id] && Number(itemBy[id].serial_number_management) === 1);
  if (serial.length) return fail("IA_RV_NOT_ELIGIBLE", iarvNotEligible("serial numbers"), { reason: "serial numbers", items: serial });
  const subs = iaList(b.subtracts);
  // RES-01 R5: an IA that reserves - its holds must be closed (its completion's CLOSE); a component issued from Reserved (its hold) comes
  // back to the bucket its hold came from (this cycle's Delivered rows: resRevertAdds / resRevertBound, review I3); the reverted Draft is
  // marked RESERVING (HDR.mark)
  const resRead = iaRows(S.res)[0] || null;
  const hold = resRead ? iaS(resRead.hold) : "";
  if (hold && (Number(resRead.live) > 0 || iaList(resRead.rows).length > 0)) {
    return fail("IA_RV_HOLDS_OPEN", "This Item Assembly still holds materials reserved for it: they are closed when it is opened. Open it once, then revert it.");
  }
  const built = iaList(b.adds);
  const adds = resRevertAdds(built, hold, resRead ? iaList(resRead.delivered) : [], resRevertBound(moves, e.iaId), R.items);
  if (subs.length + built.length !== L.liveRows) return fail("IA_RV_PLAN_BROKEN", "The revert could not be prepared: " + (subs.length + adds.length) + " reverse movement(s) for " + L.liveRows + " live row(s)");

  // ENGINE: the classic's SUBTRACT_INVENTORY / ADD_INVENTORY parameters per build row, in its order
  const binBy = {};
  for (const r of iarvJRows(S.bins)) binBy[iaS(r.id)] = iaS(r.bin_location_combine);
  const movements = [];
  const labels = {};
  const one = (x, dir) => {
    const key = "M" + (Number(x.index) + 1);
    const m = { movement_key: key, direction: dir, plant_id: plant, organization_id: org, material_id: iaS(x.material_id), quantity: x.quantity, material_uom: iaS(x.material_uom),
      unit_price: x.unit_price, transaction_type: "IA-R", trx_no: iaNo, inventory_category: iaS(x.inventory_category),
      // a null the platform dropped from the build's output is a null here (the engine reads both as none)
      location_id: x.location_id === undefined ? null : x.location_id, batch_id: x.batch_id === undefined ? null : x.batch_id };
    if (dir === "ADD") m.handling_unit_id = null;
    m.doc_date = x.doc_date;
    m.isMovingInv = dir === "SUBTRACT" ? 1 : 0;
    m.parent_trx_no = "";
    movements.push(m);
    const it = itemBy[m.material_id] || {};
    const bin = iaS(m.location_id);
    labels[key] = { item_code: iaS(it.material_code), item_name: iaS(it.material_name), bin: binBy[bin] || bin, bin_id: bin, category: m.inventory_category, side: dir === "SUBTRACT" ? "out" : "in" };
  };
  for (const x of subs) one(x, "SUBTRACT");
  for (const x of adds) one(x, "ADD");
  const keys = movements.map((m) => m.movement_key);
  if (new Set(keys).size !== keys.length) return fail("IA_RV_PLAN_BROKEN", "The revert could not be prepared: a movement key repeats");

  // COST: update_node_iaRvFifoDel / _WaDel / _WaUpd's rows - before as read here, after the classic's values
  const fifoBy = {};
  for (const f of R.fifo) fifoBy[iaS(f.id)] = f;
  const waBy = {};
  for (const w of R.wa) waBy[iaS(w.id)] = w;
  const cost = { material_id: iaS(p.assembledItemId), plant_id: plant, fifo: [], waDelete: [], waRestate: [] };
  const seen = {};
  for (const x of subs) {
    if (Number(x.hasFifoDelete) === 1 && !seen["F" + x.fifoDeleteId]) {
      const f = fifoBy[iaS(x.fifoDeleteId)];
      if (!f) return fail("IA_RV_PLAN_BROKEN", "The revert could not be prepared: FIFO layer " + iaS(x.fifoDeleteId) + " was not read");
      seen["F" + x.fifoDeleteId] = 1;
      cost.fifo.push({ id: iaS(f.id), material_id: iaS(x.material_id), before: { fifo_initial_quantity: iarvDec(f.fifo_initial_quantity), fifo_available_quantity: iarvDec(f.fifo_available_quantity) },
        after: { is_deleted: 1 } });
    }
    if (Number(x.hasWaDelete) === 1 && !seen["W" + x.waDeleteId]) {
      const w = waBy[iaS(x.waDeleteId)];
      if (!w) return fail("IA_RV_PLAN_BROKEN", "The revert could not be prepared: weighted-average row " + iaS(x.waDeleteId) + " was not read");
      seen["W" + x.waDeleteId] = 1;
      cost.waDelete.push({ id: iaS(w.id), material_id: iaS(x.material_id), before: { wa_quantity: iarvDec(w.wa_quantity), wa_cost_price: iarvDec(w.wa_cost_price) }, after: { is_deleted: 1 } });
    }
    if (Number(x.hasWaUpdate) === 1 && !seen["U" + x.waUpdateId]) {
      const w = waBy[iaS(x.waUpdateId)];
      if (!w) return fail("IA_RV_PLAN_BROKEN", "The revert could not be prepared: weighted-average row " + iaS(x.waUpdateId) + " was not read");
      seen["U" + x.waUpdateId] = 1;
      cost.waRestate.push({ id: iaS(w.id), material_id: iaS(x.material_id), before: { wa_quantity: iarvDec(w.wa_quantity), wa_cost_price: iarvDec(w.wa_cost_price) },
        after: { wa_quantity: iaS(x.waQuantity), wa_cost_price: iaS(x.waCostPrice) } });
    }
  }
  const batchDeletes = iaList(b.batchDeletes).map((x) => iaS(x.id));
  if (batchDeletes.some((x) => !iaDigits(x))) return fail("IA_RV_PLAN_BROKEN", "The revert could not be prepared: a batch row to remove has no id");
  const parts = {
    ENGINE: { operation_key: iaRvOpKey(jobId), mode: "APPLY", organization_id: org, movements: movements }, COST: cost, BATCH: { batchDeletes: batchDeletes },
    HDR: { id: iaS(e.iaId), before: { item_assembly_status: "Processing" }, after: { item_assembly_status: "Draft", posted_status: "" }, mark: hold ? "RESERVING" : "" }, LABELS: labels,
  };
  const nonce = (iaS(e.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const partRows = [];
  const manifestParts = {};
  for (const name of RV_PARTS_ORDER) {
    manifestParts[name] = iarvChunks(JSON.stringify(parts[name]), RV_CHUNK).map((chunk, i) => {
      const step = "P|" + nonce + "|" + name + "|" + String(i + 1).padStart(3, "0");
      partRows.push({ job_id: jobId, organization_id: org, step_name: step, step_status: "PAYLOAD", attempt_count: 0, result_ref: chunk });
      return step;
    });
  }
  const manifest = {
    v: 1, prepared_by: "IA_REVERT_V2_PREPARE", job_id: jobId, ia_id: iaS(e.iaId), ia_no: iaNo, action: "REVERT", prevStatus: iaS(e.prevStatus), organization_id: org, plant_id: plant,
    nonce: nonce, movesFingerprint: fp, parts: manifestParts,
    counts: { liveRows: L.liveRows, liveOut: L.liveOut, liveIn: L.liveIn, movements: movements.length, subtracts: subs.length, adds: adds.length, fifo: cost.fifo.length,
      waDelete: cost.waDelete.length, waRestate: cost.waRestate.length, batches: batchDeletes.length },
  };
  if (o.debug) Object.defineProperty(base, "__parts", { value: parts, enumerable: false });
  return Object.assign(base, { route: "READY", code: "200", message: "Planned " + movements.length + " reverse movement(s), " + (cost.fifo.length + cost.waDelete.length + cost.waRestate.length)
    + " costing row(s), " + batchDeletes.length + " batch row(s)", payload: JSON.stringify(manifest), partRows: partRows, lineCount: L.liveRows, movementCount: movements.length,
    needPlan: movements.length ? "YES" : "NO", operationKey: iaRvOpKey(jobId), organizationId: org, movements: movements, labels: labels, keys: keys });
};
