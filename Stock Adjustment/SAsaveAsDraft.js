const self = this;
const allData = this.getValues();
const page_status = allData.page_status;
const tableIndex = allData.dialog_index.table_index;
console.log("allData", allData);

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

this.getData()
  .then((data) => {
    this.showLoading();
    const tableIndex = data.dialog_index.table_index;
    const {
      adjustment_no,
      organization_id,
      adjustment_date,
      adjustment_type,
      adjusted_by,
      plant_id,
      adjustment_remarks,
      reference_documents,
      subform_dus1f9ob,
    } = data;

    const sa = {
      stock_adjustment_status: "Draft",
      organization_id,
      adjustment_no,
      adjustment_date,
      adjustment_type,
      adjusted_by,
      plant_id,
      adjustment_remarks,
      reference_documents,
      subform_dus1f9ob,
      table_index: tableIndex,
    };

    if (page_status === "Add") {
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      return db
        .collection("prefix_configuration")
        .where({
          document_types: "Stock Adjustment",
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
        })
        .get()
        .then((prefixEntry) => {
          if (!prefixEntry.data || prefixEntry.data.length === 0) {
            return sa;
          } else {
            const currDraftNum = parseInt(prefixEntry.data[0].draft_number) + 1;
            const newPrefix = "DRAFT-SA-" + currDraftNum;
            sa.adjustment_no = newPrefix;

            return db
              .collection("prefix_configuration")
              .where({ document_types: "Stock Adjustment" })
              .update({ draft_number: currDraftNum })
              .then(() => {
                return sa;
              });
          }
        })
        .then((updatedSa) => {
          return db.collection("stock_adjustment").add(updatedSa);
        });
    } else if (page_status === "Edit") {
      const stockAdjustmentId = allData.id;
      return db
        .collection("stock_adjustment")
        .doc(stockAdjustmentId)
        .update(sa);
    }
  })
  .then((response) => {
    console.log("Operation completed successfully:", response);
    closeDialog();
  })
  .catch((error) => {
    this.hideLoading();
    console.error("Error:", error);
    alert(
      "Please fill in all required fields marked with (*) before submitting."
    );
  });
