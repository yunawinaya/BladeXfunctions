// sli_onConfirm_plant - SO Linked IAs page, Select Plant (an organisation-level Sales Order; the user, 10-28: as SO -> GD does): a plant
// is required (a plant, never the organisation itself); the figures read again and the Item Assembly form opened for that plant
const scS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const scPlant = scS(this.getValue("sli_plant_dialog.sli_plant_id"));
if (!/^[0-9]{1,20}$/.test(scPlant) || scPlant === scS(this.getParamsVariables("organization_id"))) {
  this.$alert("Please select a plant to proceed.", "Error", { confirmButtonText: "OK", type: "error" });
} else {
  this.closeDialog("sli_plant_dialog");
  this.triggerEvent("sli_load", { action: "create", plant: scPlant });
}
