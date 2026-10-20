// IA_SAVE v13 - Small Cycle in (scIn, code/shared/sc_check.js)
const all = [{{node:code_fillback.data.allData}}][0];
const res = scIn({ allData: all, pageStatus: [{{workflowparams:pageStatus}}][0], tenantId: [{{system:tenantId}}][0] });
// the lines sent back with an id but without sc_ref_key (a mobile save): their stored keys are read with the stored fields
const ids = (all && Array.isArray(all.stock_movement) ? all.stock_movement : []).filter((l) => l && typeof l === "object" &&
  !Object.prototype.hasOwnProperty.call(l, "sc_ref_key") && /^[0-9]{1,20}$/.test(l.id === undefined || l.id === null ? "" : String(l.id))).map((l) => String(l.id));
res.lineIds = ids.length ? ids.join(",") : "0";
console.log("small cycle in", JSON.stringify(res));
return res;
