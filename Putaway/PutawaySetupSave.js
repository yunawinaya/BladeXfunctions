const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const data = this.getValues();
const {
  putaway_setup_id,
  movement_type,
  putaway_required,
  auto_trigger_to,
  putaway_mode,
  default_strategy_id,
  fallback_strategy_id,
  auto_completed_gr,
  is_loading_bay,
  storage_location_id,
  default_loading_bay,
  bin_validation_scope,
  require_bin_scan,
  require_batch_scan,
  plant_id,
  organization_id,
  require_item_scan,
} = data;

if (
  is_loading_bay === 1 &&
  (!default_loading_bay || default_loading_bay === "")
) {
  this.$message.error(
    "Please select a loading bay or create a loading bay before saving.",
  );
  return;
}

const entry = {
  movement_type,
  putaway_required,
  auto_trigger_to,
  putaway_mode,
  default_strategy_id,
  fallback_strategy_id,
  auto_completed_gr,
  is_loading_bay,
  storage_location_id,
  default_loading_bay,
  bin_validation_scope,
  require_bin_scan,
  require_batch_scan,
  plant_id,
  organization_id,
  require_item_scan,
};
if (putaway_setup_id !== "") {
  db.collection("putaway_setup").doc(putaway_setup_id).update(entry);
} else db.collection("putaway_setup").add(entry);

closeDialog();
this.$message.success("Update Sucessfully");
