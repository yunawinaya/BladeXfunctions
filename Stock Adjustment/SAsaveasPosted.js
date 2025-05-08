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
      await db
        .collection("stock_adjustment")
        .doc(stockAdjustmentId)
        .update({ posted_status: "Pending Post" });
      await this.runWorkflow(
        "1909088441531375617",
        { key: "value" },
        (res) => {
          console.log("成功结果：", res);

          this.$message.success("Post successfully");
          closeDialog();
        },
        (err) => {
          this.$message.error("失败结果：", err);
        }
      );
    } catch (error) {
      this.$message.error(error);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
})();
