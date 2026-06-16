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

const addEntry = async (organizationId, entry) => {
  try {
    console.log(this.getValue("stock_count_status"));
    await db.collection("stock_count").add(entry);
    this.$message.success("Add successfully");
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, stockCountId) => {
  try {
    await db.collection("stock_count").doc(stockCountId).update(entry);

    this.$message.success("Update successfully");
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "stock_count_no", label: "Stock Count No" },
      { name: "count_type", label: "Count Type" },
    ];

    let entry = data;
    entry.stock_count_status = "Issued";
    entry.total_counted = `0 / ${data.table_stock_count.length}`;
    entry.total_variance = `0.00%`;

    if (
      entry.stock_count_no_type !== -9999 &&
      (!entry.stock_count_no ||
        entry.stock_count_no === null ||
        entry.stock_count_no === "" ||
        entry.previous_status === "Draft")
    ) {
      entry.stock_count_no = "issued";
    }

    const missingFields = validateForm(entry, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;
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
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        await updateEntry(organizationId, entry, stockCountId);
      }
      closeDialog();
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.$message.error(error);
    console.error(error);
    this.hideLoading();
  }
})();
