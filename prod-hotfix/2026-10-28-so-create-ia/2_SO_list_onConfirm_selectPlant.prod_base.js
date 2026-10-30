(async () => {
  const plantID = this.getValue(`dialog_select_plant.plant_id`);
  const organizationID = this.getValue(`dialog_select_plant.organization_id`);
  if (plantID && plantID !== "") {
    const data = this.models["_data"];
    const selectedRecords = data.selectedRecords;
    const docType = data.doc_type;

    if (docType === "sales invoice") {
      await this.closeDialog("dialog_select_plant");
      await this.triggerEvent("func_handleConvertSI", {
        selectedRecords,
        plantID,
        organizationID,
      });
      return;
    } else if (docType === "goods delivery") {
      let plants = new Set(selectedRecords.map((record) => record.plant_name));
      plants = plants.delete(organizationID);

      if (plants.size === 1) {
        if (!plants.has(plantID)) {
          await this.$alert(
            "Selected plant does not match with any of the selected sales orders.",
            "Error",
            {
              confirmButtonText: "OK",
              type: "error",
            },
          );
          return;
        } else {
          await this.closeDialog("dialog_select_plant");
          await this.triggerEvent("func_handleConvertGD", {
            selectedRecords,
            plantID,
            organizationID,
          });
        }
      } else {
        await this.closeDialog("dialog_select_plant");
        await this.triggerEvent("func_handleConvertGD", {
          selectedRecords,
          plantID,
          organizationID,
        });
      }
    }
  } else {
    await this.$alert("Please select a plant to proceed.", "Error", {
      confirmButtonText: "OK",
      type: "error",
    });
    return;
  }
})();
