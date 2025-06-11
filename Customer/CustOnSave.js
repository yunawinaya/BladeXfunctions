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
      document_types: "Customers",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber) => {
  await db
    .collection("prefix_configuration")
    .where({
      document_types: "Customers",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      await updatePrefix(organizationId, prefixData.running_number);

      db.collection("Customer").add(entry);
      this.$message.success("Add successfully");
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (entry, customerId) => {
  try {
    db.collection("Customer").doc(customerId).update(entry);
    this.$message.success("Update successfully");
  } catch (error) {
    this.$message.error(error);
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "customer_status", label: "Customer Status" },
      { name: "customer_id", label: "Customer Code" },
      { name: "customer_com_name", label: "Company Name" },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        customer_status,
        customer_type,
        customer_id,
        customer_com_name,
        business_type_id,
        customer_irbm_id,
        created_date,
        customer_com_reg_no,
        customer_com_old_reg_no,
        customer_area_id,
        customer_agent_id,
        customer_currency_id,
        customer_tax_rate_id,
        customer_tin_no,
        customer_credit_limit,
        overdue_limit,
        outstanding_balance,
        overdue_inv_total_amount,
        is_accurate,
        control_type_list,
        customer_payment_term_id,
        customer_sst_sales_no,
        customer_sst_service_no,
        is_exceed_limit,
        address_list,
        contact_list,
        customer_twitter,
        customer_linkedin,
        customer_facebook,
        customer_website,
        customer_instagram,
        customer_remark,
        attachment,
      } = data;

      const entry = {
        customer_status,
        organization_id: organizationId,
        customer_type,
        customer_id,
        customer_com_name,
        business_type_id,
        customer_irbm_id,
        created_date,
        customer_com_reg_no,
        customer_com_old_reg_no,
        customer_area_id,
        customer_agent_id,
        customer_currency_id,
        customer_tax_rate_id,
        customer_tin_no,
        customer_credit_limit,
        customer_payment_term_id,
        customer_sst_sales_no,
        customer_sst_service_no,
        overdue_limit,
        outstanding_balance,
        overdue_inv_total_amount,
        is_accurate,
        control_type_list,
        is_exceed_limit,
        address_list,
        contact_list,
        customer_twitter,
        customer_linkedin,
        customer_facebook,
        customer_website,
        customer_instagram,
        customer_remark,
        attachment,
      };

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
        await closeDialog();
      } else if (page_status === "Edit") {
        const customerId = this.getValue("id");
        await updateEntry(entry, customerId);
        await closeDialog();
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
