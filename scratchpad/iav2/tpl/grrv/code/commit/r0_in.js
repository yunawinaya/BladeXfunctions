// GR_REVERT_COMMIT - R0 input: the CHECK and COST parts -> the keys of the fresh reads (digits only) and what they must show
const commitR0In = function commitR0In(entry, checkRows, costRows) {
  const chk = joinChunks(checkRows, entry.partPrefix + "CHECK|");
  const cost = joinChunks(costRows, entry.partPrefix + "COST|");
  const none = { ok: "NO", why: "the CHECK / COST part of the prepared payload is missing", minLiveIdSql: "0", itemIdsCsv: "0", plantIdSql: "0", fifoIdsSql: "0", waIdsSql: "0",
    anchors: {}, names: {}, fifo: [], waDelete: [] };
  if (!chk || !cost) return none;
  const anchors = {};
  for (const k of Object.keys(chk.anchors || {})) if (digits(chk.anchors[k])) anchors[k] = s(chk.anchors[k]);
  return {
    ok: "YES", why: "", minLiveIdSql: digits(chk.minLiveId) ? s(chk.minLiveId) : entry.grId, itemIdsCsv: idsSql(chk.itemIds), plantIdSql: entry.plantId,
    fifoIdsSql: idsSql(list(cost.fifo).map((f) => f.id)), waIdsSql: idsSql(list(cost.waDelete).map((w) => w.id)), anchors: anchors, names: chk.names || {},
    fifo: list(cost.fifo), waDelete: list(cost.waDelete),
  };
};
const res = commitR0In([{{node:code_node_VCentry.data}}][0], [{{node:sql_node_VCr0check.data}}][0], [{{node:sql_node_VCr0cost.data}}][0]);
console.log("commit R0 input", JSON.stringify({ ok: res.ok, why: res.why, anchors: Object.keys(res.anchors).length, fifo: res.fifo.length, wa: res.waDelete.length }));
return res;
