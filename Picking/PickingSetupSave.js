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
      auto_completed_si,
      bin_validation_scope,
      require_bin_scan,
      require_batch_scan,
      require_item_scan,
      require_hu_scan,
      organization_id,
      split_policy,
      full_cl_check,
      convert_gd_created,
      lot_picking_required,
      pt_picking_required,
      msi_picking_required,
      sp_auto_advance,
      sp_allow_full_picking,
    } = data;

    // Loading Bay staging requires the GD to pass through "Created" so the
    // Reserved allocation can be shuttled from the source bin to the bay bin.
    // Auto Complete GD skips that state entirely, leaving the reservation
    // stranded at the source while the delivery reads from the bay.
    if (is_loading_bay === 1 && auto_completed_gd === 1) {
      this.$message.error(
        "Loading Bay cannot be used together with Auto Complete GD. " +
          "Turn off Auto Complete GD so the Goods Delivery passes through Created.",
      );
      return;
    }

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
      auto_completed_si,
      bin_validation_scope,
      require_bin_scan,
      require_batch_scan,
      require_item_scan,
      require_hu_scan,
      organization_id,
      split_policy,
      full_cl_check: full_cl_check || 0,
      convert_gd_created: convert_gd_created || 0,
      // Stock Picking: one master switch per issuing movement type, plus its two
      // behaviour flags. Kept as columns rather than extra rows because every
      // picking_setup reader filters on org/plant only and takes data[0].
      lot_picking_required: lot_picking_required || 0,
      pt_picking_required: pt_picking_required || 0,
      msi_picking_required: msi_picking_required || 0,
      sp_auto_advance: sp_auto_advance || 0,
      sp_allow_full_picking: sp_allow_full_picking || 0,
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
