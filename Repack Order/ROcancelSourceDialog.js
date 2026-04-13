(async () => {
  try {
    await this.closeDialog("dialog_repack");
  } catch (error) {
    this.$message.error("Error in ROcancelSourceDialog: " + error.message);
    console.error("Error in ROcancelSourceDialog:", error);
  }
})();
