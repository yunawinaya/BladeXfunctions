const page_status = this.getParamsVariables("page_status");
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
  }
};
this.getData().then((data) => {
  const {
    supplier_status,
    organization_id,
    supplier_type,
    supplier_com_name,
    supplier_com_reg_no,
    supplier_business_type,
    supplier_irbm_id,
    supplier_code,
    supplier_com_old_reg_no,
    business_activity_id,
    supplier_area_id,
    supplier_agent_id,
    currency_id,
    supplier_tax_rate,
    supplier_tin_no,
    supplier_credit_limit,
    supplier_payment_term_id,
    supplier_sst_sales_no,
    supplier_sst_service_no,
    supplier_exceed_limit,
    address_list,
    contact_list,
    supplier_website,
    remarks,
    attachment,
  } = data;

  const entry = {
    supplier_status,
    organization_id,
    supplier_type,
    supplier_com_name,
    supplier_com_reg_no,
    supplier_business_type,
    supplier_irbm_id,
    supplier_code,
    supplier_com_old_reg_no,
    business_activity_id,
    supplier_area_id,
    supplier_agent_id,
    currency_id,
    supplier_tax_rate,
    supplier_tin_no,
    supplier_credit_limit,
    supplier_payment_term_id,
    supplier_sst_sales_no,
    supplier_sst_service_no,
    supplier_exceed_limit,
    address_list,
    contact_list,
    supplier_website,
    remarks,
    attachment,
  };
  if (page_status === "Add") {
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }
    db.collection("supplier_head")
      .add(entry)
      .then(() => {
        return db
          .collection("prefix_configuration")
          .where({
            document_types: "Suppliers",
            is_deleted: 0,
            organization_id: organizationId,
            is_active: 1,
          })
          .get()
          .then((prefixEntry) => {
            const data = prefixEntry.data[0];
            return db
              .collection("prefix_configuration")
              .where({
                document_types: "Suppliers",
                is_deleted: 0,
                organization_id: organizationId,
              })
              .update({ running_number: parseInt(data.running_number) + 1 });
          });
      })
      .then(() => {
        closeDialog();
      })
      .catch((error) => {
        this.$message.error(
          "Please fill in all required fields marked with (*) before submitting."
        );
      });
  } else if (page_status === "Edit") {
    const supplierId = this.getParamsVariables("supplier_no");
    db.collection("supplier_head")
      .doc(supplierId)
      .update(entry)
      .then(() => {
        closeDialog();
      })
      .catch((error) => {
        this.$message.error(
          "Please fill in all required fields marked with (*) before submitting."
        );
      });
  }
});
