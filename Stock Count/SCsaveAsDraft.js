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

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Count",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const generateDraftPrefix = async (organizationId) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    const currDraftNum = parseInt(prefixData.draft_number) + 1;
    const newPrefix = "DRAFT-SC-" + currDraftNum;

    db.collection("prefix_configuration")
      .where({
        document_types: "Stock Count",
        organization_id: organizationId,
      })
      .update({ draft_number: currDraftNum });

    return newPrefix;
  } catch (error) {
    this.$message.error(error);
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "count_type", label: "Count Type" },
    ];

    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;
      const stockCountId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const entry = {
        stock_count_status: "Draft",
        review_status: data.review_status,
        adjustment_status: data.adjustment_status,
        plant_id: data.plant_id,
        organization_id: organizationId,
        count_method: data.count_method,
        count_type: data.count_type,
        item_list: data.item_list,
        start_date: data.start_date,
        end_date: data.end_date,
        assignees: data.assignees,
        user_assignees: data.user_assignees,
        work_group_assignees: data.work_group_assignees,
        blind_count: data.blind_count,
        total_counted: data.total_counted,
        total_variance: data.total_variance,
        table_stock_count: data.table_stock_count,
        stock_count_remark: data.stock_count_remark,
        stock_count_remark2: data.stock_count_remark2,
        stock_count_remark3: data.stock_count_remark3,
      };

      if (!entry.table_stock_count || entry.table_stock_count.length === 0) {
        this.$message.error("No stock count items found");
        this.hideLoading();
        return;
      }

      if (page_status === "Add") {
        const newPrefix = await generateDraftPrefix(organizationId);
        entry.stock_count_no = newPrefix;
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
    this.$message.error(error);
  }
})();
