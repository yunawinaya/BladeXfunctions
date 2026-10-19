// PICKING_BULK_COMMIT - P5 chunk: the loop's current <= 25 deliveries, their HU and SO ids, the first picked row of each
const digits = (v) => /^[0-9]{1,20}$/.test(String(v));
const chunk = [{{node:loop_PCp5chunks}}][0] || {};
const gdIds = (Array.isArray(chunk.gdIds) ? chunk.gdIds : []).map(String).filter(digits);
const res = {
  gdIds: gdIds.length ? gdIds : ["0"],
  huIds: Array.isArray(chunk.huIds) && chunk.huIds.length ? chunk.huIds.map(String) : ["0"],
  soIds: Array.isArray(chunk.soIds) && chunk.soIds.length ? chunk.soIds.map(String) : ["0"],
  gdIdsCsv: gdIds.length ? gdIds.join(",") : "0",
  groups: chunk.groups && typeof chunk.groups === "object" ? chunk.groups : {},
  count: gdIds.length,
};
console.log("commit P5 chunk", JSON.stringify({ count: res.count, hus: res.huIds.length, sos: res.soIds.length }));
return res;
