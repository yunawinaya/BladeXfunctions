// IA_REVERT v6 - RES-01 R5: a reverted completion of an IA that reserves (its stored material_hold_status set) checks its holds first
// (closed at completion: CLOSE); every other IA reverts exactly as v5
const ia = [{{node:get_node_iaRvIa.data.data}}][0] || {};
const row = (Array.isArray(ia) ? ia[0] : ia) || {};
const p = [{{node:code_node_iaRvPrep.data}}][0] || {};
const tenant = String([{{system:tenantId}}][0] || "");
const hold = row.material_hold_status === undefined || row.material_hold_status === null ? "" : String(row.material_hold_status);
const id = String(p.iaId || "");
const org = String(p.organizationId || "");
const due = hold !== "" && [id, org, tenant].every((x) => /^[0-9]{1,20}$/.test(x));
console.log("res revert due", JSON.stringify({ hold: hold, due: due }));
return { due: due ? "YES" : "NO", ia: due ? id : "0", org: due ? org : "0", tenantId: due ? tenant : "0", hold: hold };
