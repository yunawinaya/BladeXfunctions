// PUTAWAY_BULK_PREPARE - Plan: the stored TO (locked by this job's SUBMIT) + the job's confirmation -> the classic allData
// (pwRebuild) -> PUTAWAY's Completed path on the lifted bodies (pwChain) -> the manifest COMMIT works from, its parts as
// gd_publish_step rows (P|<nonce>|<PART>|<nnn>, 400,000 characters each). Ends READY or FAIL (unlockOk 1: the job holds the
// TO's lock and nothing was written, so a failure releases it).
// Manifest parts:
//   ENGINE { operation_key "PWC|<job>", movements: per confirmed row a SUBTRACT at the source then an ADD at the target,
//            exactly the SUBTRACT_INVENTORY / ADD_INVENTORY parameters the classic sent, + movement_key / direction }
//   TO     { to_status, lines: [{ id, before: {<col>: stored}, after: {<col>: new} }] (the columns KbJLkjP8 changes),
//            records: [new table_putaway_records rows, record columns only, + transfer_order_putaway_id, job_line_key] }
//   IT     { updates: [ITmatch.transitUpdates + before (the row as read)], creates: [ITmatch.transitCreates + job_line_key] }
//   GR     { id, putaway_status, gr_status, before: { putaway_status, gr_status } }   (code_node_ds7jurnq)
// Decimals of the TO rows are toFixed(8) strings (the in-transit rows already are: ITmatch's qtyStr).
const PW_LINE_PATCH = { pending_process_qty: "dec", putaway_qty: "dec", line_status: "str", target_location: "id", remark: "str", is_split: "str", parent_or_child: "str" };
const PW_RECORD_COLS = { line_index: "str", item_code: "id", item_name: "str", item_desc: "str", batch_no: "id", source_inv_category: "str",
  target_inv_category: "str", store_in_qty: "dec", item_uom: "id", target_location: "id", remark: "str", confirmed_by: "str", confirmed_at: "str" };
const PW_CHUNK = 400000;

// A = pwAdapt(SQL rows), or the same shapes taken from a recorded run (test/chain_parity.js)
const pwPlanA = function pwPlanA(entry, A) {
  const s = pwStr;
  const base = { route: "FAIL", code: "", message: "", payload: "", partRows: [], lineCount: 0, movementCount: 0, toId: s(entry.toId), unlockOk: 0 };
  const fail = (code, message) => Object.assign(base, { code: code, message: message });
  const req = entry.request && typeof entry.request === "object" ? entry.request : {};
  const jobId = s(entry.jobId);
  if (!A.to.count) return fail("PWC_TO_NOT_FOUND", "Putaway " + s(entry.toId) + " not found");
  const to = A.to.data;
  // this job's SUBMIT holds the TO: is_processing 1 and the latest LOCK row carries the job's idempotency key
  const mine = A.lock && s(A.lock.result_ref) !== "" && s(A.lock.result_ref) === s(entry.idempotencyKey);
  if (pwNum(to.is_processing) !== 1 || !mine) return fail("PWC_NOT_LOCKED", "Putaway " + s(to.to_id) + " is not locked by this job" + (mine ? " (is_processing is off)" : ""));
  base.unlockOk = 1;
  if (s(to.to_status) === "Completed" || s(to.to_status) === "Cancelled") return fail("PWC_TO_" + s(to.to_status).toUpperCase(), "The current putaway is already " + s(to.to_status));
  if (s(to.gr_no) !== s(entry.grId)) return fail("PWC_GR_CHANGED", "the putaway's Goods Receiving is not " + s(entry.grId));
  if (!A.gr) return fail("PWC_GR_NOT_FOUND", "Goods Receiving " + s(entry.grId) + " not found");
  if (s(A.gr.gr_status) === "Processing") return fail("PWC_GR_PROCESSING", "The current putaway is under processing (its Goods Receiving is being saved in the background)");
  if (s(req.recordedUpdateTime) && s(req.recordedUpdateTime) !== s(to.update_time)) {
    return fail("PWC_TO_CHANGED", "the putaway was changed after it was submitted (" + s(to.update_time) + "): please confirm it again");
  }
  const storedLines = pwFlat(to.table_putaway_item);
  const storedById = {};
  for (const l of storedLines) storedById[s(l.id)] = l;
  const rq = pwRequestRows(req, storedById);
  if (!rq.ok) return fail("PWC_INVALID_REQUEST", rq.message);
  const reasons = pwEligibility(A, rq, []);
  if (reasons.length) return fail("PWC_NOT_ELIGIBLE", "this putaway is completed by the classic save: " + reasons.map((r) => r.text).join("; "));

  const aliases = pwAliases(to.table_putaway_item);
  const stored = pwClone(to);
  for (const l of stored.table_putaway_item || []) if (aliases[s(l.id)] !== undefined) l.line_index = aliases[s(l.id)];
  const rb = pwRebuild(stored, rq, aliases);
  const out = pwChain({
    allData: rb.allData, confirmedBy: s(req.confirmedBy), tenantId: s(entry.tenantId), uuid: "PWC" + jobId,
    reads: { to: { count: 1, data: stored }, setup: A.setup, items: A.items, transit: A.transit, others: A.others, qi: A.qi, bbal: A.bbal },
  });
  if (out.route !== "PLANNED") return fail(out.route === "NOT_ELIGIBLE" ? "PWC_NOT_ELIGIBLE" : "PWC_VALIDATION_" + s(out.code), pwUnalias(out.message, aliases));

  // ENGINE: the classic's calls in order, paired SUBTRACT -> ADD
  const toProcess = (out.records && out.records.itemsToProcess) || [];
  const movements = [];
  let pair = 0;
  for (let i = 0; i < out.calls.length; i++) {
    const c = out.calls[i];
    if (c.direction === "SUBTRACT") pair++;
    else if (!out.calls[i - 1] || out.calls[i - 1].direction !== "SUBTRACT") return fail("PWC_PLAN_BROKEN", "an ADD without its SUBTRACT at movement " + i);
    movements.push(Object.assign({ movement_key: "M" + pair + (c.direction === "ADD" ? ".2" : ""), direction: c.direction }, c.params));
  }
  // M7XzDZ48 drops a row whose item it cannot read (the classic then records it and moves no stock): refuse instead
  if (pair !== toProcess.length) {
    const known = {};
    for (const it of A.items) known[s(it.id)] = true;
    const lost = toProcess.filter((t) => !known[s(t.item_code)]).map((t) => s(t.item_code) || "(none)");
    return fail("PWC_ITEM_NOT_FOUND", "the item of " + (toProcess.length - pair) + " confirmed row(s) could not be read (" + lost.slice(0, 5).join(", ") + ")");
  }

  // TO: the columns KbJLkjP8 changed, per stored line (line_index back from its alias)
  const empty = (v) => v === undefined || v === null || v === "";
  const dec = (v) => (empty(v) ? null : Number(parseFloat(v).toFixed(8)).toFixed(8));
  const val = (kind, v) => (kind === "dec" ? dec(v) : kind === "id" ? (empty(v) ? null : s(v)) : empty(v) ? "" : s(v));
  const same = (kind, a, b) => (kind === "dec" ? (empty(a) && empty(b)) || (!empty(a) && !empty(b) && Number(a) === Number(b)) : (empty(a) && empty(b)) || s(a) === s(b));
  const lines = [];
  const outside = [];
  for (const u of pwFlat((out.lines && out.lines.updatedItems) || [])) {
    const o = storedById[s(u.id)];
    if (!o) return fail("PWC_PLAN_BROKEN", "KbJLkjP8 answered line " + s(u.id) + ", which is not stored");
    const before = {};
    const after = {};
    for (const c of new Set(Object.keys(u).concat(Object.keys(o)))) {
      if (c === "children") continue;
      const nv = c === "line_index" ? pwUnalias(u[c], aliases) : u[c];
      const kind = PW_LINE_PATCH[c] || "str";
      if (same(kind, nv, o[c])) continue;
      if (!PW_LINE_PATCH[c]) {
        outside.push(c);
        continue;
      }
      before[c] = val(kind, o[c]);
      after[c] = val(kind, nv);
    }
    if (Object.keys(after).length) lines.push({ id: s(u.id), before: before, after: after });
  }
  if (outside.length) return fail("PWC_UNEXPECTED_PATCH", "the completion would also change line columns " + [...new Set(outside)].join(", "));
  if (pwFlat((out.lines && out.lines.updatedItems) || []).length !== storedLines.length) return fail("PWC_PLAN_BROKEN", "the completion would add or drop lines");
  // records: qfSZO0bi's (KbJLkjP8 appends them to the stored ones), each with its rerun key
  const records = pwFlat(out.records.records || []).map((r, i) => {
    const row = { transfer_order_putaway_id: s(to.id) };
    for (const c of Object.keys(PW_RECORD_COLS)) row[c] = val(PW_RECORD_COLS[c], c === "line_index" ? pwUnalias(r[c], aliases) : r[c]);
    row.job_line_key = jobId + "|" + (i + 1);
    return row;
  });
  // IT: ITmatch's updates (with the row as read: P0 / P3 compare it) and creates (each with its rerun key)
  const readIt = {};
  for (const t of A.transit) readIt[s(t.id)] = t;
  const itUpdates = (out.transit.transitUpdates || []).map((u) => {
    const r = readIt[s(u.id)] || {};
    return Object.assign({}, u, { before: { status: r.status === undefined ? null : r.status, open_qty: r.open_qty === undefined ? null : r.open_qty,
      received_qty: r.received_qty === undefined ? null : r.received_qty, transit_qty: r.transit_qty === undefined ? null : r.transit_qty } });
  });
  const itCreates = (out.transit.transitCreates || []).map((c, i) => Object.assign({}, c, { job_line_key: jobId + "|" + (i + 1) }));
  const gr = { id: s(A.gr.id), putaway_status: s(out.gr.grPutawayStatus), gr_status: s(out.gr.grStatus),
    before: { putaway_status: A.gr.putaway_status === undefined ? null : A.gr.putaway_status, gr_status: A.gr.gr_status === undefined ? null : A.gr.gr_status } };

  const parts = {
    ENGINE: { operation_key: "PWC|" + jobId, organization_id: s(to.organization_id), movements: movements },
    TO: { id: s(to.id), to_status: s(out.lines.toStatus), before: { to_status: s(to.to_status), update_time: s(to.update_time) }, lines: lines, records: records },
    IT: { updates: itUpdates, creates: itCreates },
    GR: gr,
  };
  const nonce = (s(entry.nonce).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const partRows = [];
  const manifestParts = {};
  for (const [name, value] of Object.entries(parts)) {
    const text = JSON.stringify(value);
    const names = [];
    for (let at = 0, n = 1; at < text.length || n === 1; at += PW_CHUNK, n++) {
      const step = "P|" + nonce + "|" + name + "|" + String(n).padStart(3, "0");
      names.push(step);
      partRows.push({ job_id: jobId, organization_id: s(to.organization_id), step_name: step, step_status: "PAYLOAD", attempt_count: 0, result_ref: text.slice(at, at + PW_CHUNK) });
    }
    manifestParts[name] = names;
  }
  const manifest = {
    v: 1, prepared_by: "PUTAWAY_BULK_PREPARE", job_id: jobId, to_id: s(to.id), to_no: s(to.to_id), gr_id: s(A.gr.id), gr_no: s(to.receiving_no),
    organization_id: s(to.organization_id), plant_id: s(to.plant_id), source: s(req.source), nonce: nonce, parts: manifestParts,
    counts: { rows: rb.rowCount, movements: movements.length, records: records.length, lines: lines.length, itUpdates: itUpdates.length, itCreates: itCreates.length },
  };
  Object.defineProperty(base, "__parts", { value: parts, enumerable: false });
  Object.defineProperty(base, "__chain", { value: out, enumerable: false });
  return Object.assign(base, {
    route: "READY", code: "200", message: "Planned " + movements.length + " movements for " + rb.rowCount + " rows of " + storedLines.length + " lines",
    payload: JSON.stringify(manifest), partRows: partRows, lineCount: storedLines.length, movementCount: movements.length,
  });
};
const pwPlan = function pwPlan(entry, S) {
  return pwPlanA(entry, pwAdapt(S));
};
