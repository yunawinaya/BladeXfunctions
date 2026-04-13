(async () => {
  try {
    await this.closeDialog("dialog_repack");
  } catch (error) {
    this.$message.error("Error in ROcancelTargetDialog: " + error.message);
    console.error("Error in ROcancelTargetDialog:", error);
  }
})();
