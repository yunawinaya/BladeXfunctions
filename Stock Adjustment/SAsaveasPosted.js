const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading();

    try {
      const stockAdjustmentId = this.getValue("id");
      const organizationId = this.getValue("organization_id");
      const accIntegrationType = this.getValue("acc_integration_type");
      const stock_count_id = this.getValue("stock_count_id");

      await db
        .collection("stock_adjustment")
        .doc(stockAdjustmentId)
        .update({ posted_status: "Pending Post" });

      if (stock_count_id && stock_count_id !== "") {
        await db.collection("stock_count").doc(stock_count_id).update({
          adjustment_status: "Fully Posted",
        });
      }

      if (
        accIntegrationType === "SQL Accounting" &&
        organizationId &&
        organizationId !== ""
      ) {
        console.log("Calling SQL Accounting workflow");

        await this.runWorkflow(
          "1958732352162164738",
          { key: "value" },
          async (res) => {
            console.log("成功结果：", res);
            if (res.data.status === "running") {
              // Run workflow
              await this.runWorkflow(
                "1909088441531375617",
                { key: "value" },
                (res) => {
                  console.log("成功结果：", res);
                  this.$message.success(
                    "Update Stock Adjustment successfully."
                  );
                  closeDialog();
                },
                (err) => {
                  console.error("失败结果：", err);
                  this.hideLoading();
                  throw new Error(
                    "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
                  );
                }
              );
            }
          },
          (err) => {
            console.log("失败结果：", err);

            this.hideLoading();
            throw new Error(
              "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
            );
          }
        );
      } else if (
        accIntegrationType === "AutoCount Accounting" &&
        organizationId &&
        organizationId !== ""
      ) {
        this.$message.success("Add Stock Adjustment successfully");
        await closeDialog();
        console.log("Calling AutoCount workflow");
      } else if (
        accIntegrationType === "No Accounting Integration" &&
        organizationId &&
        organizationId !== ""
      ) {
        this.$message.success("Add Stock Adjustment successfully");
        await closeDialog();
        console.log("Not calling workflow");
      } else {
        await closeDialog();
      }
    } catch (error) {
      this.$message.error(error);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
})();
