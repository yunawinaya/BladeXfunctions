// lotIatr_onClick_viewIa - Location Transfer form, onClick of button_view_ia (IA transfer request, ENH-20261027-001): the request's
// Item Assembly, read-only in its own form (production edits it there)
const IA_FORM = "2098256587713404929";
const iaId = String(this.getValue("source_ia_id") || "").trim();
if (/^[0-9]{1,20}$/.test(iaId)) {
  // on the right, as every form opens (the user, 10-28)
  this.toView({ target: IA_FORM, type: "view", mode: "dialog", position: "rtl", title: "View", width: "80%", data: { id: iaId }, viewMode: "disabled" });
}
