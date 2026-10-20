// __HANDLER_NAME__ - SO Linked IAs page, the Open link of __TABLE__: the Item Assembly in its own form (a Draft to edit, any other
// status to view; the form applies its own rules for the status).
const SC_IA_FORM = "__IA_FORM_TABLE__";
const scRow = (arguments[0] && arguments[0].row) || {};
const scId = String(scRow.ia_id === undefined || scRow.ia_id === null ? "" : scRow.ia_id).trim();
if (/^[0-9]{1,20}$/.test(scId)) {
  const draft = String(scRow.status || "") === "Draft";
  const view = { target: SC_IA_FORM, type: draft ? "edit" : "view", mode: "dialog", title: draft ? "Edit" : "View", width: "80%", data: { id: scId } };
  if (!draft) view.viewMode = "disabled";
  this.toView(view);
}
