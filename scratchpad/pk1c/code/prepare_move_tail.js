// PICKING_BULK_PREPARE 1c - Move: the moved GD lines' allocation rewritten as classic PICKING rewrites it (pkMovePlan above),
// each target checked (a bin of this plant, a batch of the item), one GD_REPLAN call per moved GD (its lines' cells as
// classic PICKING writes them before GOODS_DELIVERY re-reads the GD), and the new allocations as ALC part rows for COMMIT.
// route OK (calls to make), NONE (every moved line is already Completed on its delivery: nothing moves, as classic), FAIL.
const prepareMove = function prepareMove(entry, plan, rows, uuid) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const pad = (n) => String(n).padStart(3, "0");
  const CHUNK = 400000;
  const nonce = (s(uuid).replace(/[^0-9A-Za-z]/g, "") + "00000000").slice(0, 8);
  const out = { route: "FAIL", nonce: nonce, gdList: [], gdCalls: [], alcRows: [], needAlc: "NO", lineCount: 0, gdCount: 0, result_code: "", result_message: "" };
  const fail = (code, message) => Object.assign(out, { route: "FAIL", result_code: code, result_message: message });
  const all = list(rows);
  const of = (kind) => all.filter((r) => s(r.kind) === kind);
  const gdLines = of("L");
  const bins = {};
  for (const b of of("B")) bins[s(b.id)] = b;
  const batches = {};
  for (const t of of("T")) batches[s(t.id)] = t;
  // SUBMIT's refusals again (sql_node_PSmove's G facts, read now)
  const gds = of("G");
  const linked = gds.find((g) => Number(g.linked) > 0);
  if (linked) return fail("PK_NOT_SUPPORTED", "Goods Delivery " + s(linked.name) + " is linked to internal trading: the classic save handles it");
  if (gds.length > 25) return fail("PK_TOO_LARGE", "This confirmation moves stock on " + gds.length + " deliveries; at most 25 can be saved together. Confirm it in smaller Pickings.");
  const gdLineTotal = gds.reduce((k, g) => k + (Number(g.line_count) || 0), 0);
  if (gdLineTotal > 500) return fail("PK_TOO_LARGE", "Moving picked stock to another bin or batch is not available yet above 500 delivery lines in one confirmation (these deliveries have " + gdLineTotal + "). Nothing was saved.");
  const busy = gds.find((g) => Number(g.other_job) > 0);
  if (busy) return fail("PK_BUSY", "Goods Delivery " + s(busy.name) + " is being confirmed on another Picking in the background. Wait a moment, then try again.");
  const recs = list(plan.moveRecords);
  const label = (r) => s(r.item_name) || s(r.item_code) || s(r.gd_line_id);
  for (const r of recs) {
    if (s(r.source_bin) && s(r.target_location) && s(r.target_location) !== s(r.source_bin)) {
      const b = bins[s(r.target_location)];
      if (!b || s(b.plant_id) !== s(plan.plantId)) return fail("PK_BAD_TARGET", "the bin picked into for " + label(r) + " is not a bin of this plant");
    }
    if (s(r.batch_no) && s(r.target_batch) && s(r.target_batch) !== s(r.batch_no)) {
      const t = batches[s(r.target_batch)];
      if (!t || s(t.material_id) !== s(r.item_code)) return fail("PK_BAD_TARGET", "the batch picked for " + label(r) + " is not a batch of this item");
    }
    if (!gdLines.some((l) => s(l.id) === s(r.gd_line_id))) return fail("PK_LINE_NOT_FOUND", "the delivery line of " + label(r) + " was not found");
  }
  const mv = pkMovePlan({
    records: recs,
    gdLines: gdLines.map((l) => ({ id: s(l.id), goods_delivery_id: s(l.gd_id), material_id: s(l.material_id), picking_status: s(l.picking_status), temp_qty_data: l.temp_qty_data,
      view_stock: l.view_stock })),
    locations: Object.keys(bins).map((id) => ({ id: id, bin_location_combine: s(bins[id].name) })),
    batches: Object.keys(batches).map((id) => ({ id: id, batch_number: s(batches[id].name) })),
    hus: of("H").map((h) => ({ id: s(h.id), handling_no: s(h.name) })),
  });
  if (mv.errors.length) return fail(mv.errors[0].code, "nothing is allocated at the picked bin / batch of " + (mv.errors[0].item || mv.errors[0].gd_line_id) + " on its delivery line");
  if (!mv.lines.length) return Object.assign(out, { route: "NONE", result_message: "the moved lines are already complete on their delivery: nothing moves" });
  const stored = {};
  for (const l of gdLines) stored[s(l.id)] = s(l.picking_status);
  const status = plan.gdLineStatus || {};
  mv.gds.forEach((g, i) => {
    const cells = g.line_ids.map((id) => {
      const l = mv.lines.find((x) => x.id === id);
      return { id: id, cells: { temp_qty_data: l.temp_qty_data, prev_temp_qty_data: l.before_temp, view_stock: l.view_stock, picking_status: s(status[id]) || stored[id] || "Created" } };
    });
    out.gdCalls.push({ gi: pad(i), gd_id: g.gd_id, line_ids: g.line_ids, lines: JSON.stringify(cells) });
  });
  const text = JSON.stringify(mv.lines);
  for (let at = 0, k = 1; at < text.length; at += CHUNK, k++) {
    out.alcRows.push({ job_id: s(entry.jobId), organization_id: s(entry.organizationId), step_name: "MV|" + nonce + "|ALC|000|" + pad(k), step_status: "PAYLOAD", attempt_count: 0,
      result_ref: text.slice(at, at + CHUNK) });
  }
  return Object.assign(out, { route: "OK", gdList: out.gdCalls.map((c) => ({ gi: c.gi, gd_id: c.gd_id })),
    needAlc: "YES", lineCount: mv.lines.length, gdCount: mv.gds.length, result_message: mv.lines.length + " line(s) on " + mv.gds.length + " deliver(ies) move" });
};
const entry = { jobId: [{{node:code_node_PPentry.data.jobId}}][0], organizationId: [{{node:code_node_PPentry.data.organizationId}}][0] };
const plan = { moveRecords: [{{node:code_node_PPplan.data.moveRecords}}][0], plantId: [{{node:code_node_PPplan.data.plantId}}][0], gdLineStatus: [{{node:code_node_PPplan.data.gdLineStatus}}][0] };
const res = prepareMove(entry, plan, [{{node:sql_node_PPmove.data}}][0], [{{system:uuid}}][0]);
console.log("prepare move", JSON.stringify({ route: res.route, lines: res.lineCount, gds: res.gdCount, result: res.result_code, message: res.result_message }));
return res;
