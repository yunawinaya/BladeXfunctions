// GD_COMPLETE_COMMIT - C3 check: every planned update reads back at its target, every create exists once -> DONE
const RES_COLS = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
const commitC3Check = function commitC3Check(entry, partRows, rows) {
  const res = joinChunks(partRows, entry.partPrefix + "RES|") || {};
  const now = {};
  const made = {};
  for (const r of list(rows)) {
    const o = parseJ(r.j);
    if (!o) continue;
    if (s(r.k) === "C") made[s(o.job_line_key)] = (made[s(o.job_line_key)] || 0) + 1;
    else now[s(o.id)] = o;
  }
  const off = (res.updates || []).filter((u) => !now[s(u.id)] || !RES_COLS.every((c) => sameVal(now[s(u.id)][c], u.after[c])));
  const missing = (res.creates || []).filter((c) => !made[s(c.job_line_key)]);
  const twice = Object.keys(made).filter((k) => made[k] > 1);
  if (twice.length) return stepEnd(entry, "C3_RESERVATIONS", "reservation(s) created twice: " + twice.slice(0, 3).join(", "), true);
  if (off.length || missing.length) return stepEnd(entry, "C3_RESERVATIONS", off.length + " update(s) and " + missing.length + " create(s) do not read back", false);
  return stepOk(entry, "C3_RESERVATIONS", (res.updates || []).length + " updated, " + (res.creates || []).length + " created", "reservations written");
};
const res = commitC3Check([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc3part.data}}][0], [{{node:sql_node_CCc3back.data}}][0]);
console.log("commit C3 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
