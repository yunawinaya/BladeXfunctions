// GD_COMPLETE_COMMIT - C5 check: the header reads back Completed with its patch, every patched line its patch -> DONE
const commitC5Check = function commitC5Check(entry, partRows, rawRows) {
  const gd = joinChunks(partRows, entry.partPrefix + "GD|") || {};
  let head = null;
  const raw = {};
  for (const r of list(rawRows)) {
    const o = parseJ(r.j);
    if (!o) continue;
    if (s(r.k) === "H") head = o;
    else raw[s(o.id)] = o;
  }
  const norm = (c, v) => (c === "so_id" || c === "assigned_to") && typeof v === "string" ? parseJ(v) : v;
  const off = [];
  if (!head || s(head.gd_status) !== "Completed") off.push("header gd_status");
  for (const [c, v] of Object.entries(gd.header || {})) if (head && !sameVal(norm(c, head[c]), v)) off.push("header." + c);
  let lines = 0;
  for (const p of gd.lines || []) {
    const cur = raw[s(p.id)];
    for (const [c, v] of Object.entries(p)) if (c !== "id" && (!cur || !sameVal(norm(c, cur[c]), v))) { off.push(s(p.id) + "." + c); lines++; break; }
  }
  if (off.length) return stepEnd(entry, "C5_GD", off.length + " value(s) do not read back (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "C5_GD", (gd.lines || []).length + " line(s) + header", "delivery Completed");
};
const res = commitC5Check([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc5part.data}}][0], [{{node:sql_node_CCc5back.data}}][0]);
console.log("commit C5 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
