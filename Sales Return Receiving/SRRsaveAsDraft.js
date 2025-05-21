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
      document_types: "Sales Return Receiving",
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
    const newPrefix = "DRAFT-SRR-" + currDraftNum;

    db.collection("prefix_configuration")
      .where({
        document_types: "Sales Return Receiving",
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
    const requiredFields = [{ name: "so_id", label: "SO Number" }];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;
      const salesReturnReceivingId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        fake_so_id,
        so_id,
        so_no_display,
        sales_return_id,
        sr_no_display,
        customer_id,
        contact_person,
        srr_no,
        user_id,
        fileupload_ed0qx6ga,
        received_date,
        table_srr,
        input_y0dr1vke,
        remarks,
        plant_id,
        organization_id,
      } = data;

      const entry = {
        srr_status: "Draft",
        sr_no_display,
        so_id,
        so_no_display,
        fake_so_id,
        customer_id,
        contact_person,
        sales_return_id,
        srr_no,
        user_id,
        fileupload_ed0qx6ga,
        received_date,
        table_srr,
        input_y0dr1vke,
        remarks,
        plant_id,
        organization_id,
      };

      if (page_status === "Add") {
        const newPrefix = await generateDraftPrefix(organizationId);
        entry.srr_no = newPrefix;
        await db.collection("sales_return_receiving").add(entry);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db
          .collection("sales_return_receiving")
          .doc(salesReturnReceivingId)
          .update(entry);
        this.$message.success("Update successfully");
        closeDialog();
      }
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
