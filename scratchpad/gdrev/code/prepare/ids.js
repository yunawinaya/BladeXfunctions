// GD_REVERT_PREPARE - Ids: the classic revert's first nodes on the round-1 reads (chain.js upTo "ids") -> the pending rows, Picking
// records / headers and handling units the snapshot names, digits only ("0" when none), for the round-2 reads
const grIdsNode = function grIdsNode(entry, S) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const csv = (xs) => (xs || []).map(s).filter((x) => /^[0-9]{1,20}$/.test(x)).join(",") || "0";
  const none = { route: "SKIP", pendingIdsSql: "0", pickingRecordIdsSql: "0", ppHeaderIdsSql: "0", huIdsSql: "0", huLineIdsSql: "0", message: "" };
  if (s(entry.route) !== "GO") return none;
  const R = grReads(S);
  if (!R.gd.count) return Object.assign(none, { message: "Goods Delivery not found" });
  const stored = R.gd.data;
  stored.gd_status = "Completed";
  const out = grChain(stored, R, "ids");
  if (out.route !== "IDS") return Object.assign(none, { message: out.message || out.route });
  const i = out.ids;
  return { route: "GO", pendingIdsSql: csv(i.pendingIds), pickingRecordIdsSql: csv(i.pickingRecordIds), ppHeaderIdsSql: csv(i.ppHeaderIds), huIdsSql: csv(i.huIds),
    huLineIdsSql: csv(i.huLineIds), message: "" };
};
const entry = [{{node:code_node_RPentry.data}}][0];
const S = {
  organizationId: entry.organizationId, hdr: [{{node:sql_node_RPhdr.data}}][0], lines: [{{node:sql_node_RPlines.data}}][0], snap: [{{node:sql_node_RPsnap.data}}][0],
  soh: [{{node:sql_node_RPsoh.data}}][0], sol: [{{node:sql_node_RPsol.data}}][0], resv: [{{node:sql_node_RPresv.data}}][0], pick: [{{node:sql_node_RPpick.data}}][0],
  items: [{{node:sql_node_RPitems.data}}][0], cost: [{{node:sql_node_RPcost.data}}][0],
};
const res = grIdsNode(entry, S);
console.log("prepare ids", JSON.stringify(res));
return res;
