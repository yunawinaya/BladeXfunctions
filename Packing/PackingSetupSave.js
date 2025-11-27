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
      packing_setup_id,
      packing_required,
      auto_trigger_pkg,
      packing_mode,
      packing_location,
      packing_dimension,
      organization_id,
    } = data;

    const entry = {
      packing_required,
      auto_trigger_pkg,
      packing_mode,
      packing_location,
      packing_dimension,
      organization_id,
    };

    console.log(entry);

    if (packing_setup_id !== "") {
      await db.collection("packing_setup").doc(packing_setup_id).update(entry);

      const plantList = await db
        .collection("blade_dept")
        .where({ parent_id: entry.organization_id })
        .get()
        .then((res) => {
          return res.data.map((item) => item.id);
        });

      if (plantList.length === 0) {
        // No plants exist, use organization_id as plant_id
        const packingSetup = await db
          .collection("packing_setup")
          .where({
            plant_id: entry.organization_id,
            organization_id: entry.organization_id,
          })
          .get();
        if (packingSetup.data.length > 0) {
          await db
            .collection("packing_setup")
            .doc(packingSetup.data[0].id)
            .update(entry);
        }
      } else {
        // Plants exist, update for each plant
        for (const plant of plantList) {
          const packingSetup = await db
            .collection("packing_setup")
            .where({ plant_id: plant, organization_id: entry.organization_id })
            .get();
          if (packingSetup.data.length > 0) {
            await db
              .collection("packing_setup")
              .doc(packingSetup.data[0].id)
              .update(entry);
          }
        }
      }
    } else {
      await db.collection("packing_setup").add(entry);

      const plantList = await db
        .collection("blade_dept")
        .where({ parent_id: entry.organization_id })
        .get()
        .then((res) => {
          return res.data.map((item) => item.id);
        });

      if (plantList.length === 0) {
        // No plants exist, use organization_id as plant_id
        await db.collection("packing_setup").add({
          ...entry,
          plant_id: entry.organization_id,
          organization_id: entry.organization_id,
        });
      } else {
        // Plants exist, create for each plant
        for (const plant of plantList) {
          await db.collection("packing_setup").add({
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
