// GD_COMPLETE_COMMIT - C6 plan: Item last_transaction_date (code_node_62FzZA2e: the materials of the lines, the time of the
// save as ISO), REORDER_SET_REDIS GD_COMPLETED when it has deltas, auto-SI (GD_CONVERT_SI) - each call at most once
const commitC6Plan = function commitC6Plan(entry, partRows) {
  const after = joinChunks(partRows, entry.partPrefix + "AFTER|");
  if (!after) return { route: "END", itemSlices: [], reorderRows: [], needReorder: "NO", reorderPrevious: [], reorderLatest: [], siRows: [], needSi: "NO", gdIds: [],
    stepRows: [], needStep: "NO", jobRows: stepEnd(entry, "C6_AFTER", "the after part of the prepared payload is missing", true).jobRows, needJobUpd: "YES" };
  const date = new Date().toISOString();
  const items = (after.item_dates || []).filter(digits).map((id) => ({ id: id, last_transaction_date: date }));
  const reorder = after.reorder && entry.doneC6Reorder !== "YES" ? after.reorder : null;
  const si = Number(after.auto_si) === 1 && entry.doneC6Si !== "YES";
  return {
    route: "GO", itemSlices: slicesOf(items, 250),
    // the marker row is written BEFORE the call: a crashed run never repeats it (at most once, as GD V2's P7E_REORDER)
    reorderRows: reorder ? [doneRow(entry, "C6_REORDER", "called")] : [], needReorder: reorder ? "YES" : "NO",
    reorderPrevious: reorder ? reorder.previous || [] : [], reorderLatest: reorder ? reorder.latest || [] : [],
    siRows: si ? [doneRow(entry, "C6_SI", "called")] : [], needSi: si ? "YES" : "NO", gdIds: [entry.gdId],
    stepRows: [], needStep: "NO", jobRows: [], needJobUpd: "NO",
  };
};
const res = commitC6Plan([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc6part.data}}][0]);
console.log("commit C6 plan", JSON.stringify({ route: res.route, items: res.itemSlices.reduce((a, x) => a + x.rows.length, 0), reorder: res.needReorder, si: res.needSi }));
return res;
