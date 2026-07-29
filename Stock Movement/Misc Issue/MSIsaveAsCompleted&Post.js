const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const postToAccounting = async (stockMovementId, organizationId) => {
  const resAI = await db
    .collection("accounting_integration")
    .where({ organization_id: organizationId })
    .get();
  const aiData = resAI.data[0];

  if (aiData.acc_integration_type !== "No Accounting Integration") {
    await db
      .collection("sm_misc_issue")
      .doc(stockMovementId)
      .update({ posted_status: "Pending Post" });
  } else {
    await db.collection("sm_misc_issue").doc(stockMovementId).update({
      posted_status: "",
      stock_movement_status: "Completed",
    });
  }

  switch (aiData.acc_integration_type) {
    case "SQL Accounting":
      await this.runWorkflow(
        "1958732352162164738",
        { key: "value" },
        async (res) => {
          if (res.data.status === "running") {
            await this.runWorkflow(
              "1910197713380311041",
              { key: "value" },
              () => {
                this.$message.success(
                  "Misc Issue completed and posted successfully.",
                );
                closeDialog();
              },
              (err) => {
                console.error("SQL Accounting post error:", err);
                this.$message.error(
                  "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
                );
                closeDialog();
              },
            );
          }
        },
        (err) => {
          console.error("SQL Accounting workflow error:", err);
          this.$message.error(
            "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
          );
          closeDialog();
        },
      );
      break;

    case "AutoCount Accounting":
      await this.runWorkflow(
        "1996041187778228226",
        { sm_id: [stockMovementId] },
        () => {
          this.$message.success("Misc Issue completed and posted successfully.");
          closeDialog();
        },
        (err) => {
          console.error("AutoCount workflow error:", err);
          this.$message.error(
            "Your AutoCount accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
          );
          closeDialog();
        },
      );
      break;

    case "No Accounting Integration":
      this.$message.success("Misc Issue completed successfully.");
      closeDialog();
      break;

    case "SQL Accounting V2":
    case "AutoCount Accounting V2":
      this.$message.success("Misc Issue completed successfully.");
      closeDialog();
      await this.runWorkflow(
        "2013511169625042946",
        {
          agent_id: aiData.agent_id,
          task_type: "post_smi",
          payload: [stockMovementId],
          priority: "0",
        },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          console.log("失败结果：", err);
        },
      );
      break;

    default:
      closeDialog();
      break;
  }
};

// Runs the Completed workflow, handling the zero-quantity filter confirmation.
// Returns the stock movement id on success, or null if the save did not complete.
const runCompleteWorkflow = async (data, filterZero) => {
  let workflowResult;

  await this.runWorkflow(
    "2015602242971631618",
    {
      allData: data,
      saveAs: "Completed",
      pageStatus: data.page_status,
      filter_zero: filterZero,
    },
    async (res) => {
      workflowResult = res;
    },
    (err) => {
      console.error("Failed to save Misc Issue:", err);
      this.hideLoading();
      workflowResult = err;
    },
  );

  if (!workflowResult || !workflowResult.data) {
    this.hideLoading();
    this.$message.error("No response from workflow");
    return null;
  }

  if (
    workflowResult.data.code === "400" ||
    workflowResult.data.code === 400 ||
    workflowResult.data.success === false
  ) {
    this.hideLoading();
    const errorMessage =
      workflowResult.data.msg ||
      workflowResult.data.message ||
      "Failed to save Misc Issue";
    this.$message.error(errorMessage);
    return null;
  }

  if (
    workflowResult.data.code === "401" ||
    workflowResult.data.code === 401 ||
    workflowResult.data.success === false
  ) {
    this.hideLoading();
    await this.$confirm(
      workflowResult.data.msg ||
        workflowResult.data.message ||
        "Failed to save Misc Issue",
      "Confirmation",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "error",
        dangerouslyUseHTMLString: true,
      },
    );

    this.showLoading("Saving Misc Issue as Completed & Posting...");
    return await runCompleteWorkflow(data, "Yes");
  }

  if (
    workflowResult.data.code === "200" ||
    workflowResult.data.code === 200 ||
    workflowResult.data.success === true
  ) {
    return workflowResult.data.id;
  }

  this.hideLoading();
  this.$message.error("Unknown workflow status");
  return null;
};

(async () => {
  try {
    this.showLoading("Saving Misc Issue as Completed & Posting...");

    const data = this.getValues();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Step 1: Run the Completed workflow (with zero-quantity filter handling)
    const stockMovementId = await runCompleteWorkflow(data, "No");

    if (!stockMovementId) {
      return;
    }

    // Step 2: Update posted status and call the posting workflow based on
    // the organization's accounting integration type
    await postToAccounting(stockMovementId[0], organizationId);
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
    const errorMessage =
      error.message || "Failed to complete and post Misc Issue";
    this.$message.error(errorMessage);
  }
})();
