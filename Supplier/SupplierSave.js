const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    this.showLoading();

    const data = this.getValues();
    console.log("Form data:", data);

    const page_status = data.page_status;
    const supplier_no = data.id;

    // Define required fields
    const requiredFields = [
      { name: "supplier_type", label: "Supplier Type" },
      { name: "supplier_com_name", label: "Company Name" },
      { name: "supplier_com_reg_no", label: "Company Registration No" },
    ];

    // Validate form
    const missingFields = requiredFields.filter((field) => {
      const value = data[field.name];
      if (Array.isArray(value)) return value.length === 0;
      if (typeof value === "string") return value.trim() === "";
      return !value;
    });

    if (missingFields.length > 0) {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(
        `Please fill in all required fields: ${missingFieldNames}`
      );
      return;
    }

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Prepare entry data
    const {
      supplier_status,
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
      organization_id: organizationId,
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

    // Clean up undefined/null values
    Object.keys(entry).forEach((key) => {
      if (entry[key] === undefined || entry[key] === null) {
        delete entry[key];
      }
    });

    // Add or update based on page status
    if (page_status === "Add" || page_status === "Clone") {
      try {
        // First add the entry
        await db.collection("supplier_head").add(entry);

        // Then update the prefix
        const prefixEntry = await db
          .collection("prefix_configuration")
          .where({
            document_types: "Suppliers",
            is_deleted: 0,
            organization_id: organizationId,
            is_active: 1,
          })
          .get();

        if (prefixEntry.data && prefixEntry.data.length > 0) {
          const data = prefixEntry.data[0];
          await db
            .collection("prefix_configuration")
            .where({
              document_types: "Suppliers",
              is_deleted: 0,
              organization_id: organizationId,
            })
            .update({
              running_number: parseInt(data.running_number) + 1,
              has_record: 1,
            });
        }

        // Close dialog after successful operation
        closeDialog();
      } catch (error) {
        console.error("Error adding supplier:", error);
        this.hideLoading();
        this.$message.error(
          error.message || "An error occurred while adding the supplier."
        );
      }
    } else if (page_status === "Edit") {
      try {
        // Update the existing supplier
        if (!supplier_no) {
          throw new Error("Supplier ID not found");
        }

        await db.collection("supplier_head").doc(supplier_no).update(entry);

        // Close dialog after successful operation
        closeDialog();
      } catch (error) {
        console.error("Error updating supplier:", error);
        this.hideLoading();
        this.$message.error(
          error.message || "An error occurred while updating the supplier."
        );
      }
    } else {
      this.hideLoading();
      this.$message.error("Invalid page status");
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.hideLoading();
    this.$message.error(
      error.message || "An error occurred while processing the supplier."
    );
  }
})();
