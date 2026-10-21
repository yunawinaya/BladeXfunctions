// IA_SAVE - RES-01 R4: a completion (this block runs for !Draft) of an IA that reserves - an Edit (a Clone carries its source's id), a
// stored material_hold_status, whatever the switch (the switch only makes holds; review I4) - reads its own holds and hold tickets before
// anything is checked or issued
const all = [{{node:code_fillback.data.allData}}][0] || {};
const page = String([{{workflowparams:pageStatus}}][0] || "");
const rows = [{{node:sql_node_SCsource.data}}][0];
let stored = "";
try {
  const r = (Array.isArray(rows) ? rows : rows ? [rows] : [])[0];
  const j = r && r.j !== undefined ? (typeof r.j === "string" ? JSON.parse(r.j) : r.j) : null;
  stored = j && j.hold !== null && j.hold !== undefined ? String(j.hold) : "";
} catch (e) {
  stored = "";
}
const id = all.id === undefined || all.id === null ? "" : String(all.id);
const tenant = String([{{system:tenantId}}][0] || "");
const org = all.organization_id === undefined || all.organization_id === null ? "" : String(all.organization_id);
const due = page === "Edit" && /^[0-9]{1,20}$/.test(id) && stored !== "" && /^[0-9]{1,20}$/.test(tenant) && /^[0-9]{1,20}$/.test(org);
console.log("res due", JSON.stringify({ page: page, id: id, stored: stored, due: due }));
return { due: due ? "YES" : "NO", ia: due ? id : "0", tenantId: due ? tenant : "0", org: due ? org : "0" };
