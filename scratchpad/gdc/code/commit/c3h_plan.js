// GD_COMPLETE_COMMIT - C3H plan: the classic HU decrements (_hu.js) replayed on a FRESH read, recorded as an intent (C3H|I|nnn:
// each changed row's before + after) before anything is written; a re-run works from the intent: at after = done, at before
// = write, else review. The stock has moved already: a handling unit short of the delivery is a review, not a failure
const commitC3HPlan = function commitC3HPlan(entry, partRows, intentRows, huRows, itemRows, precRows) {
  const base = { route: "GO", needIntent: "NO", intentRows: [], huSlices: [], huCount: 0, itemSlices: [], itemCount: 0, jobRows: [], needJobUpd: "NO", result_code: "", result_message: "" };
  const hus = {};
  for (const h of huParse(huRows)) hus[s(h.id)] = h;
  const items = {};
  for (const r of huParse(itemRows)) items[s(r.id)] = r;
  let intent = joinChunks(intentRows, "C3H|I|");
  if (intent === undefined) return Object.assign(base, stepEnd(entry, "C3H_HU", "the recorded intent cannot be read", true));
  if (!intent) {
    const hu = joinChunks(partRows, entry.partPrefix + "HU|");
    if (!Array.isArray(hu)) return Object.assign(base, stepEnd(entry, "C3H_HU", "the handling-unit part of the prepared payload is missing", true));
    const r = huReplay(hu, Object.keys(hus).map((k) => hus[k]), Object.keys(items).map((k) => items[k]), huRules(precRows));
    if (r.short.length) return Object.assign(base, stepEnd(entry, "C3H_HU", "the handling units no longer hold what was delivered (" + r.short.slice(0, 3).join("; ") + ")", true));
    intent = { hus: r.hus, items: r.items };
    base.needIntent = "YES";
    base.intentRows = chunkRows(entry, "C3H|I|", intent);
  }
  const conflicts = [];
  const sort = (rows, now, col) => {
    const writes = [];
    for (const r of rows || []) {
      const cur = now[r.id];
      if (!cur || String(cur.is_deleted) !== "0") {
        conflicts.push(r.id + " (gone)");
        continue;
      }
      if (sameVal(cur[col], r.after)) continue;
      if (!sameVal(cur[col], r.before)) {
        conflicts.push(r.id);
        continue;
      }
      const w = { id: r.id };
      w[col] = r.after;
      writes.push(w);
    }
    return writes;
  };
  const huWrites = sort(intent.hus, hus, "total_quantity");
  const itemWrites = sort(intent.items, items, "quantity");
  if (conflicts.length) return Object.assign(base, stepEnd(entry, "C3H_HU", conflicts.length + " handling-unit row(s) changed by someone else meanwhile (e.g. " + conflicts.slice(0, 3).join(", ") + ")", true));
  return Object.assign(base, { huSlices: slicesOf(huWrites, 250), huCount: huWrites.length, itemSlices: slicesOf(itemWrites, 250), itemCount: itemWrites.length,
    result_message: huWrites.length + " handling unit(s), " + itemWrites.length + " item row(s) to write" });
};
const res = commitC3HPlan([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc3hpart.data}}][0], [{{node:sql_node_CCc3hintent.data}}][0],
  [{{node:sql_node_CCc3hhus.data}}][0], [{{node:sql_node_CCc3hitems.data}}][0], [{{node:sql_node_CCc3hprec.data}}][0]);
console.log("commit C3H plan", JSON.stringify({ route: res.route, intent: res.needIntent, hus: res.huCount, items: res.itemCount, result: res.result_code, message: res.result_message }));
return res;
