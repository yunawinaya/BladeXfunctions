// GR_COMPLETE_COMMIT - C4 check: the Transfer Order Putaway with every line, every in-transit row of the receipt -> DONE
const commitC4Check = function commitC4Check(entry, toPartRows, toRows, itRows) {
  const part = joinChunks(toPartRows, entry.partPrefix + "TO|") || {};
  const to = list(toRows).filter((r) => s(r.id));
  const wantLines = (part.lines || []).length;
  if (part.header && (to.length !== 1 || num(to[0].line_count) !== wantLines)) return stepEnd(entry, "C4_PUTAWAY", "the Transfer Order Putaway reads back as " + (to.length ? num(to[0].line_count) + " of " + wantLines + " line(s)" : "missing"), false);
  const want = {};
  for (const r of part.inTransit || []) want[s(r.line_id)] = (want[s(r.line_id)] || 0) + 1;
  const have = {};
  for (const r of list(itRows)) {
    const o = parseJ(r.j);
    if (o && o.id) have[s(o.doc_line_id)] = (have[s(o.doc_line_id)] || 0) + 1;
  }
  const off = Object.keys(want).filter((k) => have[k] !== want[k]);
  if (off.length) return stepEnd(entry, "C4_PUTAWAY", off.length + " receipt line(s) without their in-transit rows after the write (e.g. " + off.slice(0, 3).join(", ") + ")", false);
  return stepOk(entry, "C4_PUTAWAY", (to.length ? "TO " + s(to[0].to_id) + " " + s(to[0].id) + ", " : "") + Object.keys(want).length + " in-transit line(s)", "putaway added");
};
const res = commitC4Check([{{node:code_node_RCentry.data}}][0], [{{node:sql_node_RCc4part.data}}][0], [{{node:sql_node_RCc4toB.data}}][0], [{{node:sql_node_RCc4itB.data}}][0]);
console.log("commit C4 check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
