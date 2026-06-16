const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return !value;
  });
  return missingFields;
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const page_status = data.page_status;
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "count_type", label: "Count Type" },
      { name: "stock_count_no", label: "Stock Count No" },
    ];

    let entry = data;
    entry.stock_count_status = "Draft";

    if (page_status === "Add") {
      if (
        entry.stock_count_no_type !== -9999 &&
        (!entry.stock_count_no ||
          entry.stock_count_no === null ||
          entry.stock_count_no === "")
      ) {
        entry.stock_count_no = "draft";
      }
    }

    const missingFields = validateForm(entry, requiredFields);

    if (missingFields.length === 0) {
      const stockCountId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      entry.organization_id = organizationId;
      if (!entry.table_stock_count || entry.table_stock_count.length === 0) {
        this.$message.error("No stock count items found");
        this.hideLoading();
        return;
      }

      if (page_status === "Add") {
        await db.collection("stock_count").add(entry);
        this.$message.success("Add successfully");
      } else if (page_status === "Edit") {
        await db.collection("stock_count").doc(stockCountId).update(entry);
        this.$message.success("Update successfully");
      }
      closeDialog();
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.hideLoading();
    console.error(error);
    this.$message.error(error);
  }
})();
