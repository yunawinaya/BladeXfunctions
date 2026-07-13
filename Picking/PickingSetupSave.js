const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    const data = this.getValues();
    const {
      picking_setup_id,
      movement_type,
      picking_required,
      picking_after,
      auto_trigger_to,
      is_loading_bay,
      allow_full_picking,
      picking_mode,
      default_strategy_id,
      fallback_strategy_id,
      auto_completed_gd,
      bin_validation_scope,
      require_bin_scan,
      require_batch_scan,
      require_item_scan,
      require_hu_scan,
      organization_id,
      split_policy,
    } = data;

    const entry = {
      movement_type,
      picking_required,
      picking_after,
      auto_trigger_to,
      is_loading_bay,
      allow_full_picking,
      picking_mode,
      default_strategy_id,
      fallback_strategy_id,
      auto_completed_gd,
      bin_validation_scope,
      require_bin_scan,
      require_batch_scan,
      require_item_scan,
      require_hu_scan,
      organization_id,
      split_policy,
    };

    if (picking_setup_id !== "") {
      await db.collection("picking_setup").doc(picking_setup_id).update(entry);

      const plantList = await db
        .collection("blade_dept")
        .where({ parent_id: entry.organization_id })
        .get()
        .then((res) => {
          return res.data.map((item) => item.id);
        });

      if (plantList.length === 0) {
        // No plants exist, use organization_id as plant_id
        const pickingSetup = await db
          .collection("picking_setup")
          .where({
            plant_id: entry.organization_id,
            organization_id: entry.organization_id,
          })
          .get();
        if (pickingSetup.data.length > 0) {
          await db
            .collection("picking_setup")
            .doc(pickingSetup.data[0].id)
            .update(entry);
        } else {
          // Create new picking_setup for organization level
          await db.collection("picking_setup").add({
            ...entry,
            plant_id: entry.organization_id,
            organization_id: entry.organization_id,
          });
        }
      } else {
        // Plants exist, update or create for each plant
        for (const plant of plantList) {
          const pickingSetup = await db
            .collection("picking_setup")
            .where({ plant_id: plant, organization_id: entry.organization_id })
            .get();
          if (pickingSetup.data.length > 0) {
            await db
              .collection("picking_setup")
              .doc(pickingSetup.data[0].id)
              .update(entry);
          } else {
            // Create new picking_setup for this plant
            await db.collection("picking_setup").add({
              ...entry,
              plant_id: plant,
              organization_id: entry.organization_id,
            });
          }
        }
      }
    } else {
      await db.collection("picking_setup").add(entry);

      const plantList = await db
        .collection("blade_dept")
        .where({ parent_id: entry.organization_id })
        .get()
        .then((res) => {
          return res.data.map((item) => item.id);
        });

      if (plantList.length === 0) {
        // No plants exist, use organization_id as plant_id
        await db.collection("picking_setup").add({
          ...entry,
          plant_id: entry.organization_id,
          organization_id: entry.organization_id,
        });
      } else {
        // Plants exist, create for each plant
        for (const plant of plantList) {
          await db.collection("picking_setup").add({
            ...entry,
            plant_id: plant || entry.organization_id,
            organization_id: entry.organization_id,
          });
        }
      }
    }

    // Fix any existing records with null plant_id for this organization
    const allOrgRecords = await db
      .collection("picking_setup")
      .where({ organization_id: entry.organization_id })
      .get();

    for (const record of allOrgRecords.data) {
      if (
        record.plant_id === null ||
        record.plant_id === "" ||
        record.plant_id === undefined
      ) {
        await db
          .collection("picking_setup")
          .doc(record.id)
          .update({ plant_id: record.organization_id });
        console.log(`Fixed null plant_id for record ${record.id}`);
      }
    }

    closeDialog();
    this.$message.success("Update Successfully");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
