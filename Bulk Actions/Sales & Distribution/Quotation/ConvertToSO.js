// Run Workflow: Convert Quotation to Sales Order
const CONVERT_SO_WORKFLOW_ID = "2094630468129980417";

const escapeHTML = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const handleConvertSO = async (selectedRecords, convertType) => {
  this.showLoading("Converting to Sales Order...");

  await this.runWorkflow(
    CONVERT_SO_WORKFLOW_ID,
    {
      sqt_ids: selectedRecords.map((record) => record.id),
      so_type: convertType,
      // The workflow takes each order's plant off its own quotation; the
      // parameter is here for a future plant-picker, like the GD flow has.
      plant_id: "",
      organization_id: this.getVarGlobal("firstLvDeptId"),
    },
    async (res) => {
      const mappedData = res?.data?.data || [];

      if (convertType === "single") {
        this.hideLoading();

        if (mappedData.length === 0) {
          await this.$alert(
            "No sales order could be built from the selected quotations.",
            "Could Not Convert",
            { confirmButtonText: "OK", type: "error" },
          );
          return;
        }

        // Single always opens the form for review, so nothing is saved until
        // the user submits it.
        await this.toView({
          target: "1902773735979597826",
          type: "add",
          data: { ...mappedData[0] },
          position: "rtl",
          mode: "dialog",
          width: "80%",
          title: "Add",
        });
        return;
      }

      this.hideLoading();
      await this.refresh();

      await this.$alert(
        `Successfully created ${mappedData.length} draft sales orders.`,
        "Success Converted to Sales Orders",
        {
          confirmButtonText: "OK",
          dangerouslyUseHTMLString: true,
          type: "success",
        },
      );
    },
    async (err) => {
      this.hideLoading();

      this.$alert(err, "Error", {
        confirmButtonText: "OK",
        type: "error",
        dangerouslyUseHTMLString: true,
      });
    },
  );
};

(async () => {
  try {
    const unCompletedListID = "custom_kviatmto";
    const allListID = "custom_851imkgn";
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

    if (!selectedRecords || selectedRecords.length === 0) {
      this.$message.error("Please select at least one record.");
      return;
    }

    const completedRecords = selectedRecords.filter(
      (item) => item.sqt_status === "Completed",
    );

    // Only Issued quotations will be sent for conversion.
    selectedRecords = selectedRecords.filter(
      (item) => item.sqt_status === "Issued",
    );

    // No Issued quotation remains to convert.
    if (selectedRecords.length === 0) {
      await this.$alert(
        completedRecords.length > 0
          ? `The following quotations are already completed and cannot be converted:<br><br>${completedRecords
              .map((item) => escapeHTML(item.sqt_no))
              .join("<br>")}`
          : "No selected records are available for conversion. Please select records with status 'Issued'.",
        "Cannot Convert",
        {
          confirmButtonText: "OK",
          dangerouslyUseHTMLString: true,
          type: "warning",
        },
      );
      return;
    }

    const confirmationMessage =
      completedRecords.length > 0
        ? `The following quotations are already completed and will be skipped:<br><br>${completedRecords
            .map((item) => escapeHTML(item.sqt_no))
            .join(
              "<br>",
            )}<br><br><strong>Continue converting these Issued quotation(s)?</strong><br><br>${selectedRecords
            .map((item) => escapeHTML(item.sqt_no))
            .join("<br>")}`
        : `Only these quotation records are available for conversion. Proceed?<br><br>
          <strong>Selected Records:</strong><br> ${selectedRecords
            .map((item) => escapeHTML(item.sqt_no))
            .join("<br>")}`;

    await this.$confirm(confirmationMessage, "Confirm Conversion", {
      confirmButtonText: "Proceed",
      cancelButtonText: "Cancel",
      dangerouslyUseHTMLString: true,
      type: "info",
    }).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    if (selectedRecords.length > 1) {
      await this.$confirm(
        `You have selected ${selectedRecords.length} quotation records. Would you like to convert these into a single sales order or into multiple sales orders?<br><br>
        <strong>Single SO:</strong> All items combined into one document<br>
        <strong>Multiple SOs:</strong> Separate orders for better tracking`,
        "Quotation Conversion",
        {
          confirmButtonText: "Single SO",
          cancelButtonText: "Multiple SOs",
          dangerouslyUseHTMLString: true,
          type: "info",
          distinguishCancelAndClose: true,

          beforeClose: async (action, instance, done) => {
            if (action === "confirm") {
              await handleConvertSO(selectedRecords, "single");
            } else if (action === "cancel") {
              await handleConvertSO(selectedRecords, "multiple");
            } else {
              this.hideLoading();
              done();
              return;
            }

            await this.getComponent(
              activeTab === "Uncompleted" ? unCompletedListID : allListID,
            )?.$refs.crud.clearSelection();

            this.hideLoading();
            done();
          },
        },
      );
    } else {
      await handleConvertSO(selectedRecords, "single");
    }

    await this.getComponent(
      activeTab === "Uncompleted" ? unCompletedListID : allListID,
    )?.$refs.crud.clearSelection();

    this.hideLoading();
  } catch (error) {
    console.error(error);
    this.hideLoading();
  }
})();
