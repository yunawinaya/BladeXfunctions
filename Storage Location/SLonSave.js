const page_status = this.getValue("page_status");

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const validateRequiredFields = (data) => {
  const requiredFields = [
    { name: "plant_id", label: "Plant" },
    { name: "storage_location_name", label: "Name" },
    { name: "storage_location_code", label: "Code" },
    { name: "location_type", label: "Location Type" },
  ];

  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];

    if (Array.isArray(value)) {
      return value.length === 0;
    } else if (typeof value === "string") {
      return value.trim() === "";
    } else {
      return !value;
    }
  });

  return missingFields;
};

const checkExistingDefaultStorage = async (
  plantId,
  currentStorageId,
  locationType
) => {
  const resStorageLocation = await db
    .collection("storage_location")
    .where({ plant_id: plantId, is_default: 1, location_type: locationType })
    .get();

  if (
    resStorageLocation.data.length > 0 &&
    resStorageLocation.data[0].id !== currentStorageId
  ) {
    return resStorageLocation.data[0];
  }

  return null;
};

const save = async () => {
  try {
    const data = await this.getValues();

    const missingFields = validateRequiredFields(data);

    if (missingFields.length > 0) {
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
      return;
    }
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
      table_bin_location,
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
      table_bin_location,
    };

    const storageLocationId = this.getValue("id");

    // Check for existing default storage location
    if (is_default === 1) {
      const existingDefaultStorage = await checkExistingDefaultStorage(
        plant_id,
        storageLocationId,
        entry.location_type
      );

      if (existingDefaultStorage) {
        await this.openDialog("default_dialog");
        setTimeout(async () => {
          await this.setData({
            [`default_dialog.default_storage_location`]:
              existingDefaultStorage.storage_location_name,
            [`default_dialog.default_storage_id`]: existingDefaultStorage.id,
            [`default_dialog.current_storage_location`]: storage_location_name,
          });
        }, 100);
        return;
      }
    }

    // Save storage location
    if (page_status === "Add") {
      await db.collection("storage_location").add(entry);
      this.$message.success("Storage location added successfully");
      closeDialog();
    } else if (page_status === "Edit") {
      await db
        .collection("storage_location")
        .doc(storageLocationId)
        .update(entry);
      this.$message.success("Storage location updated successfully");
      closeDialog();
    }
  } catch (error) {
    console.error("Error saving storage location:", error);
    this.$message.error(
      `Failed to save storage location: ${error.message || "Unknown error"}`
    );
  }
};

save();
