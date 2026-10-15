// Digits-only keys for the Item and in-transit reads below (interpolated into SQL)
const DIG = /^[0-9]{1,20}$/;
const codes = [{{node:code_node_qfSZO0bi.data.uniqueItemCodes}}][0] || [];
const ids = [];
for (const c of Array.isArray(codes) ? codes : []) {
  const s = String(c === null || c === undefined ? "" : c).trim();
  if (DIG.test(s) && !ids.includes(s)) ids.push(s);
}
const grId = String([{{node:code_node_qfSZO0bi.data.grId}}][0] || "").trim();
const orgId = String([{{node:code_node_qfSZO0bi.data.organizationId}}][0] || "").trim();
return {
  itemIdsCsv: ids.length ? ids.join(",") : "0",
  grId: DIG.test(grId) ? grId : "0",
  orgId: DIG.test(orgId) ? orgId : "0",
};