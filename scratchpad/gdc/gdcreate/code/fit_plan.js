// GD_ASYNC_SUBMIT - V2 fit (plan): this save's lines in compact form and the digits-only ids of the fit read, which runs
// in parallel with the job read; the decision waits for the create-or-return route.
@@GDV2_FIT@@
const fitPlan = function fitPlan(guard) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  let payload = {};
  try {
    payload = JSON.parse(s(guard.payloadText) || "{}");
  } catch (e) {
    payload = {};
  }
  const fit = gdV2FitLines(payload);
  const digits = (v) => (/^[0-9]{1,20}$/.test(s(v)) ? s(v) : "0");
  const ids = (xs) => xs.filter((x) => /^[0-9]{1,19}$/.test(x));
  return {
    linesJson: JSON.stringify(fit.rows),
    tenantSql: digits(guard.tenantId),
    orgSql: digits(guard.organizationId),
    plantSql: digits(guard.plantId),
    materialIdsSql: ids(fit.materialIds).join(",") || "0",
    autoMaterialIdsSql: ids(fit.autoMaterialIds).join(",") || "0",
    soLineIdsSql: ids(fit.soLineIds).map((x) => "'" + x + "'").join(",") || "'0'",
  };
};
const res = fitPlan({ tenantId: [{{node:code_node_EluyWNR5.data.tenantId}}][0], organizationId: [{{node:code_node_EluyWNR5.data.organizationId}}][0], plantId: [{{node:code_node_EluyWNR5.data.plantId}}][0], payloadText: [{{node:code_node_EluyWNR5.data.payloadText}}][0] });
console.log("submit V2 fit plan", JSON.stringify({ rows: JSON.parse(res.linesJson).length, auto: res.autoMaterialIdsSql === "0" ? 0 : res.autoMaterialIdsSql.split(",").length }));
return res;
