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
      picking_mode,
      default_strategy_id,
      fallback_strategy_id,
      auto_completed_gd,
      bin_validation_scope,
      require_bin_scan,
      require_batch_scan,
      // plant_id,
      organization_id,
    } = data;

    const entry = {
      movement_type,
      picking_required,
      picking_after,
      auto_trigger_to,
      is_loading_bay,
      picking_mode,
      default_strategy_id,
      fallback_strategy_id,
      auto_completed_gd,
      bin_validation_scope,
      require_bin_scan,
      require_batch_scan,
      // plant_id,
      organization_id,
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
          .where({ plant_id: entry.organization_id, organization_id: entry.organization_id })
          .get();
        if (pickingSetup.data.length > 0) {
          await db
            .collection("picking_setup")
            .doc(pickingSetup.data[0].id)
            .update(entry);
        }
      } else {
        // Plants exist, update for each plant
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
            plant_id: plant,
            organization_id: entry.organization_id,
          });
        }
      }
    }

    closeDialog();
    this.$message.success("Update Sucessfully");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
