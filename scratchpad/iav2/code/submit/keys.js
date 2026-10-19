// IA_V2_SUBMIT - Keys: the record (INVALID when it is not one), the lifted code_fillback + code_item_ids, the reads' digit-only inputs
const submitKeys = function submitKeys(guard, entry, form) {
  const base = { ok: "NO", why: "", reason: "", errorCode: "", itemIdsSql: "0", pickPairsJson: "[]", costPairsJson: "[]", balTuplesJson: "[]", batchTuplesJson: "[]",
    plantId: "0", organizationId: "0", lineCount: 0, pickCount: 0 };
  const out = (a) => Object.assign(base, a);
  if (!obj(form)) return out(answer("INVALID", "400", "form: the Item Assembly's record", { errorCode: "IA_INVALID_REQUEST" }));
  if (guard.pageStatus === "Edit" && iaIdStr(form.id) && iaIdStr(form.id) !== guard.iaId) {
    return out(answer("INVALID", "400", "form: not the record of Item Assembly " + guard.iaId, { errorCode: "IA_INVALID_REQUEST" }));
  }
  let f = null;
  try {
    f = iaFill(guard, form);
  } catch (e) {
    return out(answer("STOP", "400", "The Item Assembly could not be checked: " + s(e && e.message), { errorCode: "IA_INVALID_DATA" }));
  }
  const a = f.allData;
  const lines = a.stock_movement;
  base.lineCount = lines.length;
  base.pickCount = iaPickCount(lines);
  const org = guard.pageStatus === "Edit" ? s(entry.organizationId) : guard.organizationId;
  if (!digits(org)) return out(answer("STOP", "400", "The Item Assembly has no organization.", { errorCode: "IA_INVALID_DATA" }));
  const parent = iaIdStr(a.item_id);
  const pairs = [];
  const bals = [];
  const batchBals = [];
  for (const l of lines) {
    const m = iaIdStr(l.item_selection);
    for (const p of iaPicks(l)) {
      const loc = iaIdStr(p.location_id);
      const b = iaIdStr(p.batch_id);
      pairs.push([m, b || "0"]);
      bals.push([m, loc]);
      if (b) batchBals.push([m, loc, b]);
    }
  }
  return out(answer("GO", "", "", { ok: "YES", itemIdsSql: iaIdsSql(f.itemIds), pickPairsJson: iaTuples(pairs), costPairsJson: iaTuples(pairs.concat([[parent, "0"]])),
    balTuplesJson: iaTuples(bals.concat([[parent, iaIdStr(a.location_id)]])), batchTuplesJson: iaTuples(batchBals), plantId: iaIdStr(a.issuing_operation_faci) || "0",
    organizationId: org }));
};
const res = submitKeys([{{node:code_node_ISguard.data}}][0], [{{node:code_node_ISentry.data}}][0], [{{workflowparams:form}}][0]);
console.log("submit keys", JSON.stringify({ route: res.route, lines: res.lineCount, picks: res.pickCount, items: res.itemIdsSql.split(",").length - 1, plant: res.plantId }));
return {
  route: res.route, code: res.code, message: res.message, reason: res.reason, errorCode: res.errorCode, ok: res.ok, why: res.why, itemIdsSql: res.itemIdsSql,
  pickPairsJson: res.pickPairsJson, costPairsJson: res.costPairsJson, balTuplesJson: res.balTuplesJson, batchTuplesJson: res.batchTuplesJson, plantId: res.plantId,
  organizationId: res.organizationId, lineCount: res.lineCount, pickCount: res.pickCount
};
