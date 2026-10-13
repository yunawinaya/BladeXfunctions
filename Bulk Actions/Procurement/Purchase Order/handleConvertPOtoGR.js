// Run Workflow: Convert Purchase Order to Goods Receiving (PO_Convert_GR).
// Same pattern as the Convert to PI button on this list.
const CONVERT_GR_WORKFLOW_ID = "2109907206996594689";

// Resolves with "confirm", "cancel" or "close" instead of rejecting, so each
// of a dialog's two buttons can stand for a choice.
const askChoice = (message, title, confirmButtonText, cancelButtonText) =>
  this.$confirm(message, title, {
    confirmButtonText,
    cancelButtonText,
    dangerouslyUseHTMLString: true,
    type: "info",
    distinguishCancelAndClose: true,
  })
    .then(() => "confirm")
    .catch((action) => action);

const handleConvertGR = async (poIds, isMultiple, plantID) => {
  this.showLoading("Converting to Goods Receiving...");

  await this.runWorkflow(
    CONVERT_GR_WORKFLOW_ID,
    {
      po_ids: poIds,
      is_multiple: isMultiple,
      plant_id: plantID,
      received_by: this.getVarGlobal("nickname") || "",
    },
    async (res) => {
      this.hideLoading();
      const data = res?.data || {};

      if (isMultiple === "single") {
        // One GR for every selected order, opened in the add form for review.
        await this.toView({
          target: "1901845517592285186",
          type: "add",
          data: {
            ...data.gr_data,
          },
          position: "rtl",
          mode: "dialog",
          width: "80%",
          title: "Add",
        });
        return;
      }

      const grList = data.gr_list || [];
      const skipped = data.skipped || [];

      await this.refresh();
      await this.$alert(
        `Successfully created ${grList.length} draft goods receipts.<br><br>
          <strong>Goods Receiving Numbers:</strong><br> ${grList
            .map((gr) => gr.gr_no)
            .join("<br>")}${
            skipped.length > 0
              ? `<br><br><strong>Skipped (fully received):</strong><br> ${skipped.join("<br>")}`
              : ""
          }`,
        "Success Converted to Goods Receipts",
        {
          confirmButtonText: "OK",
          dangerouslyUseHTMLString: true,
          type: "success",
        },
      );
    },
    async (err) => {
      console.error(err);
      this.hideLoading();
      const code = err?.data?.code;
      const message = err?.data?.msg || err?.msg || String(err);

      if (code === 405) {
        // Different suppliers: one GR cannot hold them.
        const proceed = await this.$confirm(message, "Multiple Suppliers Detected", {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          dangerouslyUseHTMLString: true,
          type: "info",
        })
          .then(() => true)
          .catch(() => false);

        if (proceed) await handleConvertGR(poIds, "multiple", plantID);
      } else if (code === 402) {
        // Nothing convertible, every line fully received, or no GR numbering rule.
        await this.$alert(message, "Unable to Convert", {
          confirmButtonText: "OK",
          dangerouslyUseHTMLString: true,
          type: "warning",
        });
      } else {
        await this.$alert(message, "Error", {
          confirmButtonText: "OK",
          dangerouslyUseHTMLString: true,
          type: "error",
        });
      }
    },
  );
};

(async () => {
  try {
    const selectedRecords = arguments[0].selectedRecords;
    const plantID = arguments[0].plantID;

    console.log("handleConvertGR selectedRecords:", selectedRecords);

    let isMultiple = "single";

    if (selectedRecords.length > 1) {
      const choice = await askChoice(
        `Would you like to convert these into a single goods receipt or into multiple goods receipts?<br><br>
          <strong>Single GR:</strong> All items combined into one document<br>
          <strong>Multiple GRs:</strong> Separate receipts for better tracking`,
        "Purchase Order Conversion",
        "Single GR",
        "Multiple GRs",
      );

      if (choice === "close") return;
      isMultiple = choice === "confirm" ? "single" : "multiple";
    }

    await handleConvertGR(
      [...new Set(selectedRecords.map((record) => String(record.id)))],
      isMultiple,
      plantID ? String(plantID) : "",
    );
  } catch (error) {
    console.error("Error in handleConvertGR:", error);
    this.hideLoading();
  }
})();
