// PICKING_BULK_PREPARE 1c - one moved GD (the loop's item): GD_REPLAN's answer checked against what V2 writes (the moved
// lines' new allocation and stock text, no line added or dropped, no other line's allocation changed, no reorder change),
// its movement keys made unique in the job (G<gi>.M<n>, unit_price_from too), its reservation creates keyed
// <job>|R|<gi>.<k>, then written as part rows: a VERDICT row always (the loop never returns), ENG and RES only when it
// planned. Reads only its own GD's cells (the loop item), never the whole move: this node runs once per moved GD.
const prepareReplanCheck = function prepareReplanCheck(entry, call, rp, nonce) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const CHUNK = 400000;
  const ALLOCATION = ["temp_qty_data", "view_stock", "prev_temp_qty_data"];
  const jobId = s(entry.jobId);
  const gi = s(call.gi);
  const r = rp || {};
  const want = {};
  try {
    for (const l of list(typeof call.lines === "string" ? JSON.parse(call.lines) : call.lines)) want[s(l.id)] = l.cells || {};
  } catch (e) { /* no cells: every line below disagrees */ }
  const mine = list(call.line_ids).map(s);
  let verdict = "OK";
  if (s(r.route) !== "PLANNED") verdict = s(r.message) || "the delivery could not be re-planned (" + (s(r.code) || "no answer") + ")";
  else if (Number(r.gdl_inserts || 0) !== 0 || Number(r.gdl_deletes || 0) !== 0) verdict = "the re-plan would add or remove delivery lines";
  else if (list(r.reorder).length) verdict = "the re-plan would change reorder tracking";
  else {
    const patch = {};
    for (const p of list(r.gdl_patches)) patch[s(p.id)] = p.cells || {};
    for (const id of mine) {
      const w = want[id] || {};
      const c = patch[id] || {};
      if (c.temp_qty_data !== w.temp_qty_data || c.view_stock !== w.view_stock) { verdict = "the re-plan disagrees with the new allocation of line " + id; break; }
    }
    // the plan's rule: if the chain does more than the move, refuse rather than widen (PM3 writes the moved lines only)
    const other = verdict === "OK" ? Object.keys(patch).find((id) => mine.indexOf(id) < 0 && ALLOCATION.some((k) => Object.prototype.hasOwnProperty.call(patch[id], k))) : undefined;
    if (other) verdict = "the re-plan would change the allocation of line " + other + ", which this pick does not move";
  }
  const movements = verdict === "OK" ? list(r.movements).map((m) => {
    const x = Object.assign({}, m, { movement_key: "G" + gi + "." + s(m.movement_key) });
    if (s(m.unit_price_from)) x.unit_price_from = "G" + gi + "." + s(m.unit_price_from);
    return x;
  }) : [];
  const res = verdict === "OK" ? { updates: list(r.res_updates), creates: list(r.res_creates).map((c, k) => Object.assign({}, c, { job_line_key: jobId + "|R|" + gi + "." + (k + 1) })) } : { updates: [], creates: [] };
  const partRows = [];
  const put = (part, value) => {
    const text = JSON.stringify(value);
    for (let at = 0, k = 1; at < text.length || k === 1; at += CHUNK, k++) {
      partRows.push({ job_id: jobId, organization_id: s(entry.organizationId), step_name: "MV|" + s(nonce) + "|" + part + "|" + gi + "|" + String(k).padStart(3, "0"), step_status: "PAYLOAD",
        attempt_count: 0, result_ref: text.slice(at, at + CHUNK) });
    }
  };
  put("VRD", { gd_id: s(call.gd_id), gd_no: s(r.gd_no), verdict: verdict, code: s(r.code), line_count: Number(r.line_count || 0), movements: movements.length, updates: res.updates.length,
    creates: res.creates.length });
  if (verdict === "OK") {
    put("ENG", movements);
    put("RES", res);
  }
  return { verdict: verdict, partRows: partRows };
};
const res = prepareReplanCheck({ jobId: [{{node:code_node_PPentry.data.jobId}}][0], organizationId: [{{node:code_node_PPentry.data.organizationId}}][0] }, [{{node:loop_PPreplan}}][0],
  [{{node:workflow_node_PPreplan.data}}][0], [{{node:code_node_PPmove.data.nonce}}][0]);
console.log("prepare replan check", JSON.stringify({ gd: res.partRows.length ? res.partRows[0].step_name : "", verdict: res.verdict, rows: res.partRows.length }));
return res;
