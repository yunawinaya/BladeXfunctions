const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    const data = this.getValues();
    const page_status = data.page_status;
    const stockMovementId = data.id;

    this.showLoading("Saving...");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    let entry = data;
    entry.stock_movement_status = "Completed";
    entry.posted_status = "Pending Post";

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
                "2022201026606657537",
                { smi_id: [stockMovementId] },
                () => {
                  this.$message.success(
                    "Misc Issue completed and posted successfully.",
                  );
                  closeDialog();
                },
                (err) => {
                  console.error("SQL Accounting post error:", err);
                  closeDialog();
                  throw new Error(
                    "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
                  );
                },
              );
            }
          },
          (err) => {
            console.error("SQL Accounting workflow error:", err);
            this.hideLoading();
            throw new Error(
              "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
            );
          },
        );
        break;

      case "AutoCount Accounting":
        await this.runWorkflow(
          "2026201341103124482",
          { smi_id: [stockMovementId] },
          () => {
            this.$message.success(
              "Misc Issue completed and posted successfully.",
            );
            closeDialog();
          },
          (err) => {
            console.error("AutoCount workflow error:", err);
            closeDialog();
            throw new Error(
              "Your AutoCount accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
            );
          },
        );
        break;

      case "No Accounting Integration":
        this.$message.success("Misc Issue completed and posted successfully.");
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
            // this.$message.success("Update Misc Issue successfully.");
          },
          (err) => {
            console.log("失败结果：", err);
            // this.hideLoading();
          },
        );
        break;
    }
  } catch (error) {
    closeDialog();
    this.$message.error(error);
  }
})();
