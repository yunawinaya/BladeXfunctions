// Bulk Cancel Issued / In Progress Plant Transfers.
//
// Inventory at In Progress is identical to Issued (stock already subtracted from the
// source bin and parked as In Transit at the receiving plant's default bin), so both
// reverse through the same workflow path. Cancelling an In Progress parent also cancels
// the live "Plant Transfer (Receiving)" child in the receiving plant -- otherwise its
// Complete button would still fire against In Transit stock that no longer exists.
//
// The workflow re-reads the full document itself (if_8nnoEcce -> get_node_ulAJ3pZj), so
// the list row is passed straight through and this client makes NO database calls. The
// filter below is UX only; the authoritative guards (status, document type, and
// "already received") live in code_node_PTcancelChildFlag and return a 400.
(async () => {
  // NOTE: confirm this against the Plant Transfer list page component id.
  const listID = "plant_transfer";

  const runPTWorkflow = (record) =>
    new Promise((resolve) => {
      this.runWorkflow(
        "2025864403783462913",
        { allData: record, saveAs: "Cancelled", pageStatus: "Edit" },
        (res) => resolve(res),
        (err) => {
          console.error("Failed to cancel Plant Transfer:", err);
          resolve(err);
        },
      );
    });

  try {
    const selectedRecords =
      this.getComponent(listID)?.$refs.crud.tableSelect || [];

    if (selectedRecords.length === 0) {
      this.$message.error("Please select at least one record.");
      return;
    }

    // Only the issuing parent may be cancelled -- cancelling a receiving child on its
    // own would strand the In Transit stock with no owner.
    const cancellableRecords = selectedRecords.filter(
      (item) =>
        item.stock_movement_status === "Issued" ||
        item.stock_movement_status === "In Progress",
    );

    if (cancellableRecords.length === 0) {
      this.$message.error(
        "Please select at least one Issued or In Progress plant transfer.",
      );
      return;
    }

    const ptNumbers = cancellableRecords.map((item) => item.stock_movement_no);

    await this.$confirm(
      `You've selected ${ptNumbers.length} plant transfer(s) to cancel.<br><br>` +
        `<strong>Plant Transfer Numbers:</strong><br>${ptNumbers.join(", ")}<br><br>` +
        `The stock will be returned to the source plant and any receiving document ` +
        `will be cancelled. Do you want to proceed?`,
      "Plant Transfer Cancellation",
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

    this.showLoading("Cancelling Plant Transfer...");

    const results = [];

    for (const ptItem of cancellableRecords) {
      try {
        const workflowResult = await runPTWorkflow(ptItem);

        if (!workflowResult || !workflowResult.data) {
          results.push({
            no: ptItem.stock_movement_no,
            success: false,
            error: "No response from workflow",
          });
          continue;
        }

        const resultCode = workflowResult.data.code;

        // 400 carries the server guard message ("already been received", wrong status,
        // receiving child) -- surface it so the user knows why this one was refused.
        if (
          resultCode === "400" ||
          resultCode === 400 ||
          workflowResult.data.success === false
        ) {
          results.push({
            no: ptItem.stock_movement_no,
            success: false,
            error:
              workflowResult.data.msg ||
              workflowResult.data.message ||
              "Failed to cancel Plant Transfer",
          });
          continue;
        }

        if (
          resultCode === "200" ||
          resultCode === 200 ||
          workflowResult.data.success === true
        ) {
          results.push({ no: ptItem.stock_movement_no, success: true });
        } else {
          results.push({
            no: ptItem.stock_movement_no,
            success: false,
            error: "Unknown workflow status",
          });
        }
      } catch (error) {
        results.push({
          no: ptItem.stock_movement_no,
          success: false,
          error: error.message || "Failed to cancel",
        });
      }
    }

    this.hideLoading();
    this.refresh();

    const successCount = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      this.$message.error({
        message:
          `${successCount} cancelled, ${failed.length} failed:<br>` +
          failed.map((r) => `${r.no}: ${r.error}`).join("<br>"),
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `Successfully cancelled ${successCount} plant transfer(s).`,
      );
    }
  } catch (error) {
    this.hideLoading();
    if (error.message) {
      this.$message.error(error.message);
    }
    console.error("Error in bulk cancel process:", error);
  }
})();
