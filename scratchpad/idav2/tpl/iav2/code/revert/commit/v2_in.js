// IA_REVERT_V2_COMMIT - V2 input: the COST part -> the rows to read fresh and the materials to lock
const commitV2In = function commitV2In(entry, costRows) {
  const cost = iaJoinChunks(costRows, entry.partPrefix + "COST|");
  const none = { ok: "NO", why: "the COST part of the prepared payload is missing", fifoIdsSql: "0", waIdsSql: "0", fifo: [], waDelete: [], waRestate: [], materials: [] };
  if (!cost || typeof cost !== "object") return none;
  const fifo = list(cost.fifo);
  const waDelete = list(cost.waDelete);
  const waRestate = list(cost.waRestate);
  const all = fifo.concat(waDelete, waRestate);
  const bad = all.filter((r) => !digits(r.id) || !r.before || typeof r.before !== "object" || !r.after || typeof r.after !== "object");
  if (bad.length) return Object.assign(none, { why: bad.length + " costing row(s) of the COST part have no id / before / after" });
  const mats = {};
  for (const m of [cost.material_id].concat(all.map((r) => r.material_id))) if (digits(m)) mats[s(m)] = 1;
  return { ok: "YES", why: "", fifoIdsSql: iaIdsSql(fifo.map((r) => s(r.id))), waIdsSql: iaIdsSql(waDelete.concat(waRestate).map((r) => s(r.id))), fifo: fifo, waDelete: waDelete,
    waRestate: waRestate, materials: Object.keys(mats).sort() };
};
const res = commitV2In([{{node:code_node_IVCentry.data}}][0], [{{node:sql_node_IVCv2part.data}}][0]);
console.log("commit V2 input", JSON.stringify({ ok: res.ok, fifo: res.fifo.length, waDelete: res.waDelete.length, waRestate: res.waRestate.length, materials: res.materials, why: res.why }));
return res;
