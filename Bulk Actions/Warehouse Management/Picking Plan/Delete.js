(async () => {
  try {
    const allListID = "picking_plan_table";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      const pickingPlanIds = selectedRecords
        .filter(
          (item) => item.to_status === "Draft" || item.to_status === "Cancelled"
        )
        .map((item) => item.id);

      if (pickingPlanIds.length === 0) {
        this.$message.error(
          "Please select at least one draft or cancelled picking plan."
        );
        return;
      }

      const pickingPlanNumbers = selectedRecords
        .filter(
          (item) => item.to_status === "Draft" || item.to_status === "Cancelled"
        )
        .map((item) => item.to_no);

      await this.$confirm(
        `You've selected ${
          pickingPlanNumbers.length
        } picking plan(s) to delete. <br> <strong>Picking Plan Numbers:</strong> <br>${pickingPlanNumbers.join(
          ", "
        )} <br>Do you want to proceed?`,
        "Picking Plan Deletion",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        }
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      for (const id of pickingPlanIds) {
        db.collection("picking_plan")
          .doc(id)
          .update({
            is_deleted: 1,
          })
          .then(() => this.refresh())
          .catch((error) => {
            console.error("Error in deletion process:", error);
            alert("An error occurred during deletion. Please try again.");
          });
      }
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
