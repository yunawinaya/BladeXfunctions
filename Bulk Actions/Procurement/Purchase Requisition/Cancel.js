const runCancelWorkflow = async (ids, changePO) => {
  this.showLoading("Cancelling Purchase Requisition...");
  await this.runWorkflow(
    "2001209454002507778",
    {
      preq_id: ids,
      change_po: changePO,
    },
    (res) => {
      this.hideLoading();
      this.refresh();
      this.$message.success("Successfully cancelled");
    },
    async (error) => {
      this.hideLoading();
      console.error(error);
      if (error.data?.code === 401) {
        await this.$confirm(
          error.data?.msg,
          "Purchase Requisition Cancellation",
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          },
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          throw new Error();
        });

        await runCancelWorkflow(ids, "Yes");
      }
    },
  );
};

(async () => {
  try {
    const unCompletedListID = "custom_6scpe4ng";
    const allListID = "custom_xa2fu9as";
    const tabUncompletedElement = document.getElementById(
      "tab-tab_uncompleted",
    );

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID,
    )?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    selectedRecords = selectedRecords.filter(
      (item) =>
        item.preq_status === "Issued" &&
        (item.preq_type === "Contract" || item.preq_type === "Standard"),
    );

    if (selectedRecords && selectedRecords.length > 0) {
      // Select all Purchase Requisition ids with Issued status

      const purchaseRequisitionNumbers = selectedRecords.map(
        (item) => item.pr_no,
      );

      await this.$confirm(
        `You've selected ${
          purchaseRequisitionNumbers.length
        } purchase requisition(s) to cancel. <br> <strong>Purchase Requisition Numbers:</strong> <br>${purchaseRequisitionNumbers.join(
          ", ",
        )} <br>Do you want to proceed?`,
        "Purchase Requisition Cancellation",
        {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "warning",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {
        console.log("User clicked Cancel or closed the dialog");
        throw new Error();
      });

      const preqIDs = selectedRecords.map((item) => item.id);

      await runCancelWorkflow(preqIDs, "No");
      await this.getComponent(
        activeTab === "Uncompleted" ? unCompletedListID : allListID,
      )?.$refs.crud.clearSelection();
    } else {
      this.$message.error("Please select at least one record.");
      await this.getComponent(
        activeTab === "Uncompleted" ? unCompletedListID : allListID,
      )?.$refs.crud.clearSelection();
    }
  } catch (error) {
    console.error(error);
  }
})();
