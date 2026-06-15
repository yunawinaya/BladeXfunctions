const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value, field)) {
        missingFields.push(field.label);
      }
      return;
    }

    // Handle array fields
    if (!Array.isArray(value)) {
      missingFields.push(`${field.label}`);
      return;
    }

    if (value.length === 0) {
      missingFields.push(`${field.label}`);
      return;
    }

    // Check each item in the array
    if (field.arrayType === "object" && field.arrayFields && value.length > 0) {
      value.forEach((item, index) => {
        field.arrayFields.forEach((subField) => {
          const subValue = item[subField.name];
          if (validateField(subValue, subField)) {
            missingFields.push(
              `${subField.label} (in ${field.label} #${index + 1})`,
            );
          }
        });
      });
    }
  });

  return missingFields;
};

const validateField = (value, field) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, prtLineItem] of entry.table_prt.entries()) {
      prtLineItem.supplier_id = entry.supplier_id || null;
      prtLineItem.plant_id = entry.plant || null;
      prtLineItem.billing_state_id = entry.billing_address_state || null;
      prtLineItem.billing_country_id = entry.billing_address_country || null;
      prtLineItem.shipping_state_id = entry.shipping_address_state || null;
      prtLineItem.shipping_country_id = entry.shipping_address_country || null;
      prtLineItem.line_index = index + 1;
    }
    return entry.table_prt;
  } catch (error) {
    throw new Error("Error processing purchase return.");
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    let entry = data;
    const page_status = data.page_status;
    const requiredFields = [
      { name: "plant", label: "Plant" },
      { name: "purchase_return_no", label: "Purchase Return No" },
      {
        name: "table_prt",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    if (page_status === "Add") {
      if (
        entry.purchase_return_no_type !== -9999 &&
        (!entry.purchase_return_no ||
          entry.purchase_return_no === null ||
          entry.purchase_return_no === "")
      ) {
        entry.purchase_return_no = "draft";
      }
    }

    const missingFields = await validateForm(entry, requiredFields);

    if (missingFields.length === 0) {
      const purchaseReturnId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      entry.purchase_return_status = "Draft";

      entry.table_prt = await fillbackHeaderFields(entry);

      if (page_status === "Add") {
        await db.collection("purchase_return_head").add(entry);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db
          .collection("purchase_return_head")
          .doc(purchaseReturnId)
          .update(entry);
        this.$message.success("Update successfully");
        closeDialog();
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
