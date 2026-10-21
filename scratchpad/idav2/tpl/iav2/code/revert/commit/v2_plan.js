// IA_REVERT_V2_COMMIT - V2 plan: each fresh row at after -> done, at before -> write, else REVIEW IA_RV_COST_CHANGED
const commitV2Plan = function commitV2Plan(entry, inp, fifoRows, waRows) {
  const base = { route: "GO", fifoSlices: [], fifoCount: 0, waDelSlices: [], waDelCount: 0, waSetSlices: [], waSetCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "",
    job_status: "COMMITTING_REVERT" };
  if (s(inp.ok) !== "YES") return Object.assign(base, stepEnd(entry, "V2_COST", s(inp.why), true));
  const fifo = byId(fifoRows);
  const wa = byId(waRows);
  const off = [];
  const at = (cur, vals, same) => Object.keys(vals || {}).every((c) => same(vals[c], cur[c]));
  const live = (cur) => cur && String(cur.is_deleted) !== "1";
  const fifoOut = [];
  for (const r of list(inp.fifo)) {
    const cur = fifo[s(r.id)];
    if (!cur) off.push("FIFO layer " + s(r.id) + " is gone");
    else if (!live(cur)) continue;
    else if (at(cur, r.before, iaSameVal)) fifoOut.push({ id: s(r.id), is_deleted: 1 });
    else off.push("FIFO layer " + s(r.id) + " changed (" + q8(cur.fifo_available_quantity) + " of " + q8(cur.fifo_initial_quantity) + " left)");
  }
  const waDel = [];
  for (const r of list(inp.waDelete)) {
    const cur = wa[s(r.id)];
    if (!cur) off.push("weighted-average row " + s(r.id) + " is gone");
    else if (!live(cur)) continue;
    else if (at(cur, r.before, iaSameVal)) waDel.push({ id: s(r.id), is_deleted: 1 });
    else off.push("weighted-average row " + s(r.id) + " changed");
  }
  const waSet = [];
  for (const r of list(inp.waRestate)) {
    const cur = wa[s(r.id)];
    if (!live(cur)) off.push("weighted-average row " + s(r.id) + " is gone");
    else if (at(cur, r.after, iaSameStored)) continue;
    else if (at(cur, r.before, iaSameVal)) waSet.push({ id: s(r.id), wa_quantity: r.after.wa_quantity, wa_cost_price: r.after.wa_cost_price });
    else off.push("weighted-average row " + s(r.id) + " changed (" + q8(cur.wa_quantity) + " at " + q8(cur.wa_cost_price) + ")");
  }
  if (off.length) {
    return Object.assign(base, stepEnd(entry, "V2_COST", off.length + " costing row(s) of the assembled item cannot be restored (e.g. " + off.slice(0, 3).join("; ") + ")", true, "IA_RV_COST_CHANGED"));
  }
  return Object.assign(base, {
    fifoSlices: slicesOf(fifoOut, 250), fifoCount: fifoOut.length, waDelSlices: slicesOf(waDel, 250), waDelCount: waDel.length, waSetSlices: slicesOf(waSet, 250), waSetCount: waSet.length,
    result_message: fifoOut.length + " FIFO layer(s), " + waDel.length + " weighted-average batch row(s) to remove, " + waSet.length + " weighted average(s) to restate",
  });
};
const res = commitV2Plan([{{node:code_node_IVCentry.data}}][0], [{{node:code_node_IVCv2in.data}}][0], [{{node:sql_node_IVCv2fifo.data}}][0], [{{node:sql_node_IVCv2wa.data}}][0]);
console.log("commit V2 plan", JSON.stringify({ route: res.route, fifo: res.fifoCount, waDel: res.waDelCount, waSet: res.waSetCount, result: res.result_code, message: res.result_message }));
return res;
