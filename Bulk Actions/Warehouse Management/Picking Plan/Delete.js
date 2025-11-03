(async () => {
  try {
    const allListID = "picking_plan_table";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (selectedRecords && selectedRecords.length > 0) {
      const pickingPlanData = selectedRecords.filter(
        (item) => item.to_status === "Draft" || item.to_status === "Cancelled"
      );

      if (pickingPlanData.length === 0) {
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

      for (const ppItem of pickingPlanData) {
        await db
          .collection("picking_plan")
          .doc(ppItem.id)
          .update({
            is_deleted: 1,
          })
          .catch((error) => {
            console.error("Error in deletion process:", error);
            alert("An error occurred during deletion. Please try again.");
          });

        await db
          .collection("transfer_order")
          .where({
            to_id: ppItem.to_no,
            organization_id: ppItem.organization_id,
          })
          .get()
          .then(async (res) => {
            if (res.data && res.data.length > 0) {
              await db.collection("transfer_order").doc(res.data[0].id).update({
                is_deleted: 1,
              });
            }
          });
      }
    } else {
      this.$message.error("Please select at least one record.");
    }

    this.refresh();
    this.$message.success("Picking plans deleted successfully");
  } catch (error) {
    console.error(error);
  }
})();
