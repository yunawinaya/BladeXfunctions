const page_status = this.getValue("page_status");

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const createBinLocationEntry = (binLocationId, binLocationData) => {
  return {
    bin_location_id: String(binLocationId),
    bin_location_code: binLocationData.bin_location_combine || "",
    bin_location_description: binLocationData.bin_description || "",
    is_default_bin: binLocationData.is_default || 0,
  };
};

const updateTableBinLocation = async (binLocationId, binLocationData) => {
  try {
    const resBinLocation = await db
      .collection("storage_location")
      .where({ id: binLocationData.storage_location_id })
      .get();

    if (!resBinLocation.data || resBinLocation.data.length === 0) {
      throw new Error("Storage location not found");
    }

    const storageLocation = resBinLocation.data[0];
    let tableBinLocation = storageLocation.table_bin_location || [];

    const existingBinIndex = tableBinLocation.findIndex(
      (bin) => bin.bin_location_id === binLocationId
    );

    const binEntry = createBinLocationEntry(binLocationId, binLocationData);

    if (existingBinIndex !== -1) {
      // Update existing bin location
      tableBinLocation[existingBinIndex] = binEntry;
    } else {
      // Add new bin location
      tableBinLocation.push(binEntry);
    }

    console.log("tableBinLocation", tableBinLocation);

    await db
      .collection("storage_location")
      .doc(binLocationData.storage_location_id)
      .update({
        table_bin_location: tableBinLocation,
      });
  } catch (error) {
    console.error("Error updating table bin location:", error);
    throw new Error(`Failed to update table bin location: ${error.message}`);
  }
};

const validateRequiredFields = (data) => {
  const requiredFields = [
    { name: "plant_id", label: "Plant" },
    { name: "storage_location_id", label: "Storage Location" },
    { name: "bin_name", label: "Name" },
    { name: "bin_code_tier_1", label: "Tier 1 Code" },
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

const checkExistingDefaultBin = async (
  plantId,
  storageLocationId,
  currentBinId
) => {
  const resBin = await db
    .collection("bin_location")
    .where({
      plant_id: plantId,
      is_default: 1,
      storage_location_id: storageLocationId,
    })
    .get();

  if (resBin.data.length > 0 && resBin.data[0].id !== currentBinId) {
    return resBin.data[0];
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
      bin_status,
      is_default,
      plant_id,
      storage_location_id,
      organization_id,
      bin_name,
      bin_label_tier_1,
      bin_label_tier_2,
      bin_label_tier_3,
      bin_label_tier_4,
      bin_label_tier_5,
      bin_code_tier_1,
      bin_code_tier_2,
      bin_code_tier_3,
      bin_code_tier_4,
      bin_code_tier_5,
      tier_1_active,
      tier_2_active,
      tier_3_active,
      tier_4_active,
      tier_5_active,
      bin_location_combine,
      bin_description,
      bin_qr_color,
      bin_qr_position,
      bin_tier_highlight,
    } = data;

    const entry = {
      bin_status,
      is_default,
      plant_id,
      storage_location_id,
      organization_id,
      bin_name,
      bin_label_tier_1,
      bin_label_tier_2,
      bin_label_tier_3,
      bin_label_tier_4,
      bin_label_tier_5,
      bin_code_tier_1,
      bin_code_tier_2,
      bin_code_tier_3,
      bin_code_tier_4,
      bin_code_tier_5,
      tier_1_active,
      tier_2_active,
      tier_3_active,
      tier_4_active,
      tier_5_active,
      bin_location_combine,
      bin_description,
      bin_qr_color,
      bin_qr_position,
      bin_tier_highlight,
    };

    const binLocationId = this.getValue("id");

    // Check for existing default bin
    if (is_default === 1) {
      const existingDefaultBin = await checkExistingDefaultBin(
        plant_id,
        storage_location_id,
        binLocationId
      );

      if (existingDefaultBin) {
        await this.openDialog("default_dialog");
        setTimeout(async () => {
          await this.setData({
            [`default_dialog.default_bin_location`]:
              existingDefaultBin.bin_location_combine,
            [`default_dialog.default_bin_location_id`]: existingDefaultBin.id,
            [`default_dialog.current_bin_location`]: bin_location_combine,
          });
        }, 100);
        return;
      }
    }

    // Save bin location
    if (page_status === "Add") {
      const doc = await db.collection("bin_location").add(entry);
      await updateTableBinLocation(doc.data[0].id, entry);
      this.$message.success("Bin location added successfully");
      closeDialog();
    } else if (page_status === "Edit") {
      await db.collection("bin_location").doc(binLocationId).update(entry);
      await updateTableBinLocation(binLocationId, entry);
      this.$message.success("Bin location updated successfully");
      closeDialog();
    }
  } catch (error) {
    console.error("Error saving bin location:", error);
    this.$message.error(
      `Failed to save bin location: ${error.message || "Unknown error"}`
    );
  }
};

save();
