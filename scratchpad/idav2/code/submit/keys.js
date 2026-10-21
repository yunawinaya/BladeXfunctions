// IDA_V2_SUBMIT - Keys: the record (INVALID when it is not one), the lifted code_fillback + code_item_ids, the reads' digit-only inputs
const submitKeys = function submitKeys(guard, entry, form) {
  const base = { ok: "NO", why: "", reason: "", errorCode: "", itemIdsSql: "0", pickPairsJson: "[]", costPairsJson: "[]", balTuplesJson: "[]", batchTuplesJson: "[]",
    hexJson: "[]", plantId: "0", organizationId: "0", lineCount: 0, pickCount: 0, moveCount: 0 };
  const out = (a) => Object.assign(base, a);
  if (!obj(form)) return out(answer("INVALID", "400", "form: the Item Disassembly's record", { errorCode: "IDA_INVALID_REQUEST" }));
  if (guard.pageStatus === "Edit" && idaIdStr(form.id) && idaIdStr(form.id) !== guard.idaId) {
    return out(answer("INVALID", "400", "form: not the record of Item Disassembly " + guard.idaId, { errorCode: "IDA_INVALID_REQUEST" }));
  }
  let f = null;
  try {
    f = idaFill(guard, form);
  } catch (e) {
    return out(answer("STOP", "400", "The Item Disassembly could not be checked: " + s(e && e.message), { errorCode: "IDA_INVALID_DATA" }));
  }
  const a = f.allData;
  const lines = idaRecoveryLines(a.stock_movement);
  base.lineCount = lines.length;
  base.pickCount = idaPickCount(a);
  base.moveCount = idaMoveCount(a, a.stock_movement);
  const org = guard.pageStatus === "Edit" ? s(entry.organizationId) : guard.organizationId;
  if (!digits(org)) return out(answer("STOP", "400", "The Item Disassembly has no organization.", { errorCode: "IDA_INVALID_DATA" }));
  const src = idaIdStr(a.item_id);
  const pairs = [];
  const bals = [];
  const batchBals = [];
  for (const p of idaPicks(a)) {
    const loc = idaIdStr(p.location_id);
    const b = idaIdStr(p.batch_id);
    pairs.push([src, b || "0"]);
    bals.push([src, loc]);
    if (b) batchBals.push([src, loc, b]);
  }
  const recvCost = lines.map((l) => [idaIdStr(l.item_selection), "0"]);
  const recvBals = lines.map((l) => [idaIdStr(l.item_selection), idaIdStr(l.location_id)]);
  return out(answer("GO", "", "", { ok: "YES", itemIdsSql: idaIdsSql(f.itemIds), pickPairsJson: idaTuples(pairs), costPairsJson: idaTuples(pairs.concat(recvCost)),
    balTuplesJson: idaTuples(bals.concat(recvBals)), batchTuplesJson: idaTuples(batchBals), hexJson: idaHexJson(f.batchNumbers),
    plantId: idaIdStr(a.issuing_operation_faci) || "0", organizationId: org }));
};
const res = submitKeys([{{node:code_node_DSguard.data}}][0], [{{node:code_node_DSentry.data}}][0], [{{workflowparams:form}}][0]);
console.log("submit keys", JSON.stringify({ route: res.route, lines: res.lineCount, picks: res.pickCount, moves: res.moveCount, items: res.itemIdsSql.split(",").length - 1 }));
return {
  route: res.route, code: res.code, message: res.message, reason: res.reason, errorCode: res.errorCode, ok: res.ok, why: res.why, itemIdsSql: res.itemIdsSql,
  pickPairsJson: res.pickPairsJson, costPairsJson: res.costPairsJson, balTuplesJson: res.balTuplesJson, batchTuplesJson: res.batchTuplesJson, hexJson: res.hexJson,
  plantId: res.plantId, organizationId: res.organizationId, lineCount: res.lineCount, pickCount: res.pickCount, moveCount: res.moveCount
};
