const data = this.getValues();
const page_status = data.page_status;
console.log("page_status", page_status);

if (page_status === "Add" || page_status === "Edit") {
  (async () => {
    try {
      console.log("Fetching and filtering movement types");

      const resDict = await db
        .collection("blade_dict")
        .where({ dict_value: "Stock Movement Type" })
        .get();
      const stockMovementId = resDict.data[0].id;

      const { data: allMovementTypes } = await db
        .collection("blade_dict")
        .where({ parent_id: stockMovementId })
        .get();

      if (!allMovementTypes || !allMovementTypes.length) {
        console.error("No movement types found in database");
        return;
      }

      const restrictedTypes = ["Good Issue", "Production Receipt"];

      const filteredTypes = allMovementTypes.filter(
        (type) => !restrictedTypes.includes(type.dict_value)
      );

      console.log(
        `Filtered from ${allMovementTypes.length} to ${filteredTypes.length} movement types`
      );

      console.log("filteredTypes", filteredTypes);

      this.setOptionData(["movement_type"], filteredTypes);
      console.log("Movement type options set successfully");
    } catch (error) {
      console.error("Error setting movement type options:", error);
    }
  })();
}
