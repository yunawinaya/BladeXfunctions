// GR_REVERT_COMMIT - R2 plan: this receipt's FIFO layers and weighted-average batch rows soft-deleted when still as PREPARE
// read them (update_node_grRvFifoDel / _grRvWaDel's write); a non-batch weighted average restated on the FRESH row with the
// classic's formula over every row this receipt added (q0 = q1 - B, p0 = (p1 q1 - C) / q0), recorded as an intent (R2|I|nnn:
// before + after) before anything is written; a re-run works from the intent: at after = done, at before = write, else review
const WA_COLS = ["wa_quantity", "wa_cost_price"];
const commitR2Plan = function commitR2Plan(entry, inp, intentRows, fifoRows, waRows) {
  const base = { route: "GO", needIntent: "NO", intentRows: [], fifoSlices: [], fifoCount: 0, waDelSlices: [], waDelCount: 0, waSetSlices: [], waSetCount: 0, jobRows: [], needJobUpd: "NO",
    result_code: "", result_message: "", job_status: "COMMITTING_REVERT" };
  if (s(inp.ok) !== "YES") return Object.assign(base, stepEnd(entry, "R2_COSTING", s(inp.why), true));
  const fifo = byId(fifoRows);
  const wa = byId(waRows);
  const off = [];
  const fifoOut = [];
  for (const f of list(inp.fifo)) {
    const cur = fifo[s(f.id)];
    if (!cur) off.push("FIFO layer " + s(f.id) + " is gone");
    else if (String(cur.is_deleted) === "1") continue;
    else if (Math.abs(num(cur.fifo_available_quantity) - num(cur.fifo_initial_quantity)) > EPS) off.push("FIFO layer " + s(f.id) + " was drawn down to " + q8(cur.fifo_available_quantity) + " of " + q8(cur.fifo_initial_quantity));
    else fifoOut.push({ id: s(f.id), is_deleted: 1 });
  }
  const waDel = [];
  for (const w of list(inp.waDelete)) {
    const cur = wa[s(w.id)];
    if (!cur) off.push("weighted-average row " + s(w.id) + " is gone");
    else if (String(cur.is_deleted) === "1") continue;
    else if (Math.abs(num(cur.wa_quantity) - num(w.wa_quantity)) > EPS || Math.abs(num(cur.wa_cost_price) - num(w.wa_cost_price)) > 0.00005) off.push("weighted-average row " + s(w.id) + " changed");
    else waDel.push({ id: s(w.id), is_deleted: 1 });
  }
  let intent = joinChunks(intentRows, "R2|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "R2_COSTING", "the recorded intent cannot be read", true));
  if (!intent) {
    const rows = [];
    for (const r of list(inp.waRestate)) {
      const cur = wa[s(r.id)];
      if (!cur || String(cur.is_deleted) === "1") {
        off.push("weighted-average row " + s(r.id) + " is gone");
        continue;
      }
      const B = num(r.B);
      const C = num(r.C);
      const q1 = num(cur.wa_quantity);
      const p1 = num(cur.wa_cost_price);
      if (q1 < B - EPS) {
        off.push("weighted-average row " + s(r.id) + " holds " + q8(q1) + ", below the " + q8(B) + " this receipt added");
        continue;
      }
      const q0 = q8(q1 - B);
      let p0 = p1;
      if (q0 > 0.0005) {
        p0 = q8((p1 * q1 - C) / q0);
        if (p0 < 0) {
          off.push("undoing weighted-average row " + s(r.id) + " would give a negative unit cost");
          continue;
        }
      }
      rows.push({ id: s(r.id), before: { wa_quantity: cur.wa_quantity, wa_cost_price: cur.wa_cost_price },
        after: { wa_quantity: q0 > 0.0005 ? qtyStr(q0) : "0.00000000", wa_cost_price: Math.max(0, q8(p0)).toFixed(8) } });
    }
    if (off.length) return Object.assign(base, stepEnd(entry, "R2_COSTING", off.length + " costing row(s) cannot be restored (e.g. " + off.slice(0, 3).join("; ") + ")", true));
    intent = { wa: rows };
    base.needIntent = "YES";
    base.intentRows = chunkRows(entry, "R2|I|", intent);
  }
  const waSet = [];
  for (const r of intent.wa || []) {
    const cur = wa[s(r.id)];
    if (!cur) off.push("weighted-average row " + s(r.id) + " is gone");
    else if (WA_COLS.every((c) => sameStored(r.after[c], cur[c]))) continue;
    else if (WA_COLS.every((c) => sameVal(cur[c], r.before[c]))) waSet.push(Object.assign({ id: s(r.id) }, r.after));
    else off.push("weighted-average row " + s(r.id) + " changed by someone else meanwhile");
  }
  if (off.length) return Object.assign(base, stepEnd(entry, "R2_COSTING", off.length + " costing row(s) cannot be restored (e.g. " + off.slice(0, 3).join("; ") + ")", true));
  return Object.assign(base, {
    fifoSlices: slicesOf(fifoOut, 250), fifoCount: fifoOut.length, waDelSlices: slicesOf(waDel, 250), waDelCount: waDel.length, waSetSlices: slicesOf(waSet, 250), waSetCount: waSet.length,
    result_message: fifoOut.length + " FIFO layer(s), " + waDel.length + " weighted-average batch row(s) to remove, " + waSet.length + " weighted average(s) to restate",
  });
};
const res = commitR2Plan([{{node:code_node_VCentry.data}}][0], [{{node:code_node_VCr2in.data}}][0], [{{node:sql_node_VCr2intent.data}}][0], [{{node:sql_node_VCr2fifo.data}}][0],
  [{{node:sql_node_VCr2wa.data}}][0]);
console.log("commit R2 plan", JSON.stringify({ route: res.route, intent: res.needIntent, fifo: res.fifoCount, waDel: res.waDelCount, waSet: res.waSetCount, result: res.result_code, message: res.result_message }));
return res;
