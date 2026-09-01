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

const AI_AGENT_UPSERT_WORKFLOW_ID = "2094621825355546625";

// Pushes the supplier to the AI agent's external directory. Never let a failure
// here fail the save — the record is already committed at this point.
const triggerAIAgentUpsert = async (
  supplierId,
  supplierCode,
  supplierName,
  supplierStatus,
) => {
  if (!supplierId) return;
  try {
    let code = supplierCode;
    // Auto-numbered codes are assigned server-side, so read back the real one.
    if (code === "issued") {
      const resSupplier = await db
        .collection("supplier_head")
        .doc(supplierId)
        .get();
      code = resSupplier?.data?.[0]?.supplier_code || "";
    }

    await this.runWorkflow(
      AI_AGENT_UPSERT_WORKFLOW_ID,
      {
        id: supplierId,
        supplier_code: code || "",
        supplier_name: supplierName || "",
        supplier_status: supplierStatus || "",
      },
      () => {},
      (error) => console.error("AI agent supplier upsert failed", error),
    );
  } catch (error) {
    console.error("AI agent supplier upsert failed", error);
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

    // Define required fields
    const requiredFields = [
      { name: "supplier_type", label: "Supplier Type" },
      ...(data.supplier_code_type === -9999
        ? [{ name: "supplier_code", label: "Supplier Code" }]
        : []),
      { name: "supplier_com_name", label: "Company Name" },
    ];

    const missingFields = await validateForm(data, requiredFields);

    entry.supplier_code =
      entry.supplier_code_type === -9999 || this.isEdit
        ? entry.supplier_code
        : "issued";

    if (missingFields.length === 0) {
      const page_status = data.page_status;
      const supplier_no = data.id;

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        try {
          const resSupplier = await db.collection("supplier_head").add(entry);

          await triggerAIAgentUpsert(
            resSupplier?.data?.[0]?.id,
            entry.supplier_code,
            entry.supplier_com_name,
            entry.supplier_status,
          );
          await closeDialog();
        } catch (error) {
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while adding the supplier.",
          );
        }
      } else if (page_status === "Edit") {
        try {
          await db.collection("supplier_head").doc(supplier_no).update(entry);

          await triggerAIAgentUpsert(
            supplier_no,
            entry.supplier_code,
            entry.supplier_com_name,
            entry.supplier_status,
          );
          await closeDialog();
        } catch (error) {
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while updating the supplier.",
          );
        }
      } else {
        this.hideLoading();
        this.$message.error("Invalid page status");
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
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
