(async () => {
  try {
    this.showLoading("Importing Item Alias...");
    const importData = this.models.dialog_import.import_data || {};

    this.runWorkflow(
      "2051584077818667010",
      { data: importData },
      (res) => {
        this.$message.success("Import Item Alias successfully");
        this.hideLoading();
        this.refresh();
      },
      (err) => {
        this.hideLoading();
        console.error("Error:", err);
        if (err.data.code === 401) {
          this.$alert(err.data.msg, "Validation Failed", {
            dangerouslyUseHTMLString: true,
            confirmButtonText: "OK",
          });
        }
      },
    );
  } catch (error) {
    this.hideLoading();
    console.error("Error:", error);
  }
})();
