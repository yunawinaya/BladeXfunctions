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

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    let entry = data;
    const requiredFields = [
      { name: "customer_status", label: "Customer Status" },
      { name: "customer_id", label: "Customer Code" },
      { name: "customer_com_name", label: "Company Name" },
    ];

    await this.validate("customer_id");
    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

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
    this.hideLoading();

    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
