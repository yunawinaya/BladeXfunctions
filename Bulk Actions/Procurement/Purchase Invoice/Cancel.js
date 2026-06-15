(async () => {
  try {
    const unCompletedListID = "custom_zceupuuv";
    const allListID = "custom_su1b24n6";
    const tabUncompletedElement = document.getElementById("tab-tab_unposted");

    const activeTab = tabUncompletedElement?.classList.contains("is-active")
      ? "Uncompleted"
      : "All";

    let selectedRecords;

    selectedRecords = this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID,
    )?.$refs.crud.tableSelect;

    selectedRecords = (selectedRecords || []).filter(
      (record) =>
        record.pi_status !== "Cancelled" && record.pi_status !== "Draft",
    );

    if (selectedRecords.length > 0) {
      await this.$confirm(
        `Are you sure you want to cancel the selected Purchase Invoices?<br><br>PI Numbers: <br>${selectedRecords
          .map((record) => record.purchase_invoice_no)
          .join("<br>")}`,
        "Confirmation",
        {
          confirmButtonText: "Yes",
          cancelButtonText: "No",
          type: "warning",
          dangerouslyUseHTMLString: true,
        },
      ).catch(() => {
        throw new Error("User cancelled the operation");
      });

      this.showLoading("Cancelling Purchase Invoice...");
      for (const record of selectedRecords) {
        await this.runWorkflow(
          "2066425389798764545",
          {
            pi_id: record.id,
          },
          async (res) => {
            console.log("Workflow response:", res);
            console.log(
              `Successfully cancelled PI ${record.purchase_invoice_no}`,
            );
          },
          async (err) => {
            console.error("Workflow error:", err);
            this.$message.error(
              `Failed to cancel PI ${record.purchase_invoice_no}`,
            );
            throw new Error(
              `Failed to cancel PI ${record.purchase_invoice_no}`,
            );
          },
        );
      }

      this.hideLoading();
      this.$message.success("Selected Purchase Invoices have been cancelled.");
      this.refresh();
    } else {
      this.$message.error(
        "Please select at least one completed purchase invoice.",
      );
    }
  } catch (error) {
    console.error(error);
  }
})();
