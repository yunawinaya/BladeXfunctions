const page_status = this.getValue("page_status");
const self = this;
const stockAdjustmentId = this.getValue("id");

this.showLoading();
let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    self.hideLoading();
  }
};

self
  .getData()
  .then(async (allData) => {
    if (page_status === "Edit") {
      const tableIndex = allData.dialog_index?.table_index;
      const adjustedBy = allData.adjusted_by || "system";
      const {
        adjustment_date,
        adjustment_type,
        plant_id,
        adjustment_no,
        adjustment_remarks,
        reference_documents,
        subform_dus1f9ob,
      } = allData;

      const sa = {
        stock_adjustment_status: "Completed",
        posted_status: "Pending Post",
        organization_id: organizationId,
        adjustment_no,
        adjustment_date,
        adjustment_type,
        adjusted_by: adjustedBy,
        plant_id,
        adjustment_remarks,
        reference_documents,
        subform_dus1f9ob,
        table_index: tableIndex,
      };

      console.log("Updating stock adjustment with:", sa);

      const initialData = await db
        .collection("stock_adjustment")
        .doc(stockAdjustmentId)
        .get();

      console.log("Initial data:", initialData);

      return db
        .collection("stock_adjustment")
        .doc(stockAdjustmentId)
        .update(sa);
    }
  })
  .then(() => {
    return new Promise((resolve, reject) => {
      self.runWorkflow(
        "1909088441531375617",
        { key: "value" },
        (res) => {
          console.log("Workflow success:", res);
          self.$message.success("Stock Adjustment posted successfully.");
          resolve(res);
        },
        (err) => {
          console.error("Workflow error:", err);
          self.$message.warning(
            "Stock Adjustment saved but not posted: " + err
          );
          resolve();
        }
      );
    });
  })
  .then(() => {
    console.log("Closing dialog");
    closeDialog();
  })
  .catch((error) => {
    console.error("Error in Stock Adjustment process:", error);
    self.$message.error(error.message || "An error occurred");
    self.hideLoading();
  });
