// IA_SAVE - RES-01 enrolment (scratchpad/iasc/res01/RES01_PLAN.md): holds on + saved as Draft + a new IA (Add / Clone) or one that
// already reserves (a stored material_hold_status) -> RESERVING. The desktop form then starts IA_HOLD: IA_SAVE never calls it (a
// crashed child would fail the save after the Draft write; user 10-21)
const on = ([{{node:code_node_SCin.data}}][0] || {}).res === "YES";
const saveAs = String([{{workflowparams:saveAs}}][0] || "");
const page = String([{{workflowparams:pageStatus}}][0] || "");
const id = String([{{node:code_doc_id.data.id}}][0] || "");
const rows = [{{node:sql_node_SCsource.data}}][0];
let stored = "";
try {
  const r = (Array.isArray(rows) ? rows : rows ? [rows] : [])[0];
  const j = r && r.j !== undefined ? (typeof r.j === "string" ? JSON.parse(r.j) : r.j) : null;
  stored = j && j.hold !== null && j.hold !== undefined ? String(j.hold) : "";
} catch (e) {
  stored = "";
}
const isNew = page === "Add" || page === "Clone" || page === "Copy";
const enrol = on && saveAs === "Draft" && /^[0-9]{1,20}$/.test(id) && (isNew || stored !== "");
console.log("res enrol", JSON.stringify({ on: on, saveAs: saveAs, page: page, id: id, stored: stored, enrol: enrol }));
return { enrol: enrol ? "YES" : "NO", id: enrol ? id : "", hold: enrol ? "RESERVING" : "" };
