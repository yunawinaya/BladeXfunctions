// sli_onClick_open - SO Linked IAs page, the Open link of the line's IAs: the Item Assembly in its own form (a Draft or a Created IA to
// edit, any other status to view; the form applies its own rules for the status).
const SC_IA_FORM = "2098256587713404929";
const scRow = (arguments[0] && arguments[0].row) || {};
const scId = String(scRow.ia_id === undefined || scRow.ia_id === null ? "" : scRow.ia_id).trim();
if (/^[0-9]{1,20}$/.test(scId)) {
  const edit = ["Draft", "Created"].indexOf(String(scRow.status || "")) >= 0;
  const view = { target: SC_IA_FORM, type: edit ? "edit" : "view", mode: "dialog", title: edit ? "Edit" : "View", width: "80%", data: { id: scId } };
  if (!edit) view.viewMode = "disabled";
  this.toView(view);
}
