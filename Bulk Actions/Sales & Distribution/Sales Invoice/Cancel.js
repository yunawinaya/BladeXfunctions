(async () => {
  try {
    const allListID = "custom_wfwjnk9q";

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    selectedRecords = selectedRecords.filter(
      (record) =>
        record.si_status !== "Cancelled" && record.si_status !== "Draft",
    );

    if (selectedRecords.length > 0) {
      await this.$confirm(
        `Are you sure you want to cancel the selected Sales Invoices?<br><br>SI Numbers: <br>${selectedRecords.map((record) => record.sales_invoice_no).join("<br>")}`,
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

      this.showLoading("Cancelling Sales Invoice...");
      for (const record of selectedRecords) {
        await this.runWorkflow(
          "2053854738953736194",
          {
            si_id: record.id,
          },
          async (res) => {
            console.log("Workflow response:", res);
            console.log(`Successfully cancelled SI ${record.sales_invoice_no}`);
          },
          async (err) => {
            console.error("Workflow error:", err);
            this.$message.error(
              `Failed to cancel SI ${record.sales_invoice_no}`,
            );
            throw new Error(`Failed to cancel SI ${record.sales_invoice_no}`);
          },
        );
      }

      this.hideLoading();
      this.$message.success("Selected Sales Invoices have been cancelled.");
      this.refresh();
    } else {
      this.$message.error("Please select at least one record.");
    }
  } catch (error) {
    console.error(error);
  }
})();
