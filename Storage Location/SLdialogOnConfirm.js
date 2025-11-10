const page_status = this.getValue("page_status");

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const save = async () => {
  try {
    const data = await this.getValues();

    const {
      storage_status,
      is_default,
      plant_id,
      organization_id,
      storage_location_name,
      storage_location_code,
      location_type,
      storage_description,
      storage_qr_color,
      storage_qr_position,
      storage_tier_highlight,
    } = data;

    const entry = {
      storage_status,
      is_default,
      plant_id,
      organization_id,
      storage_location_name,
      storage_location_code,
      location_type,
      storage_description,
      storage_qr_color,
      storage_qr_position,
      storage_tier_highlight,
    };

    const storageLocationId = this.getValue("id");

    const defaultStorageLocationID = this.getValue(
      "default_dialog.default_storage_id"
    );

    await db
      .collection("storage_location")
      .doc(defaultStorageLocationID)
      .update({ is_default: 0 });

    if (page_status === "Add") {
      await db.collection("storage_location").add(entry);
      this.closeDialog("default_dialog");
      closeDialog();
    } else if (page_status === "Edit") {
      await db
        .collection("storage_location")
        .doc(storageLocationId)
        .update(entry);
      this.closeDialog("default_dialog");
      closeDialog();
    }
  } catch (error) {
    this.$message.errro(error.toString() || error.message);
  }
};

save();
