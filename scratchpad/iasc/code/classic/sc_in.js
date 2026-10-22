// IA_SAVE v13 - Small Cycle in (scIn, code/shared/sc_check.js)
// RES-01 raw-material holds (scratchpad/iasc/res01/RES01_PLAN.md): the one server switch - it makes holds (enrolment, the re-mark, the
// Required follow); what an IA holds is finished whatever it says. ON on DEV since 10-22 (user)
const RES_ENABLED = true;
const all = [{{node:code_fillback.data.allData}}][0];
const res = scIn({ allData: all, pageStatus: [{{workflowparams:pageStatus}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
// the lines sent back with an id but without sc_ref_key (a mobile save) - holds on: every line with an id (required_qty kept or
// following the reference, code_node_SCcheck) - their stored values are read with the stored fields
const has = (l, k) => Object.prototype.hasOwnProperty.call(l, k);
const ids = (all && Array.isArray(all.stock_movement) ? all.stock_movement : []).filter((l) => l && typeof l === "object" &&
  (RES_ENABLED || !has(l, "sc_ref_key")) && /^[0-9]{1,20}$/.test(l.id === undefined || l.id === null ? "" : String(l.id)))
  .map((l) => String(l.id));
res.lineIds = ids.length ? ids.join(",") : "0";
res.res = RES_ENABLED ? "YES" : "NO";
console.log("small cycle in", JSON.stringify(res));
return res;
