// The PO / GR selection is its own page now rather than a dialog on this form.
// Opening it in dialog mode keeps the invoice underneath; the page hands its
// selection back by firing onConfirm_batchAddItem on this form when Confirm is
// pressed, so nothing is read off the page from here.
if (this.getValue("pi_status") === "Completed") {
  return;
}

this.toView({
  target: "2089184571995197441",
  targetType: "Page",
  mode: "dialog",
  type: "add",
  title: "Batch Add",
  params: { plant_id: this.getValue("plant_id") },
});