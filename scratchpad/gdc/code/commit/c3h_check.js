// GD_COMPLETE_COMMIT - C3H check: every handling unit and item row of the intent reads back at its after-value -> DONE
const commitC3HCheck = function commitC3HCheck(entry, intentRows, huRows, itemRows) {
  const intent = joinChunks(intentRows, "C3H|I|");
  if (!intent) return stepEnd(entry, "C3H_HU", "the recorded intent cannot be read back", false);
  const hus = {};
  for (const h of huParse(huRows)) hus[s(h.id)] = h;
  const items = {};
  for (const r of huParse(itemRows)) items[s(r.id)] = r;
  const off = (intent.hus || []).filter((r) => !hus[r.id] || !sameVal(hus[r.id].total_quantity, r.after)).length +
    (intent.items || []).filter((r) => !items[r.id] || !sameVal(items[r.id].quantity, r.after)).length;
  if (off) return stepEnd(entry, "C3H_HU", off + " handling-unit row(s) do not read back", false);
  return stepOk(entry, "C3H_HU", (intent.hus || []).length + " handling unit(s), " + (intent.items || []).length + " item row(s)", "handling units updated");
};
const res = commitC3HCheck([{{node:code_node_CCentry.data}}][0], [{{node:sql_node_CCc3hintentB.data}}][0], [{{node:sql_node_CCc3hhusB.data}}][0], [{{node:sql_node_CCc3hitemsB.data}}][0]);
console.log("commit C3H check", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
