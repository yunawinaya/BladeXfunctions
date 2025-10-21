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
              `${subField.label} (in ${field.label} #${index + 1})`
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

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Adjustment",
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
    if (prefixData.length !== 0) {
      const currDraftNum = parseInt(prefixData.draft_number) + 1;
      const newPrefix = "DRAFT-SA-" + currDraftNum;

      db.collection("prefix_configuration")
        .where({
          document_types: "Stock Adjustment",
          organization_id: organizationId,
          is_deleted: 0,
        })
        .update({ draft_number: currDraftNum });

      return newPrefix;
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const fillbackHeaderFields = async (sa) => {
  try {
    for (const [index, saLineItem] of sa.stock_adjustment.entries()) {
      saLineItem.plant_id = sa.plant_id || null;
      saLineItem.line_index = index + 1;
    }
    return sa.stock_adjustment;
  } catch (error) {
    throw new Error("Error processing Stock Adjustment.");
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      {
        name: "stock_adjustment",
        label: "Stock Adjustment Details",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;
      const stockAdjustmentId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        adjustment_no,
        organization_id,
        stock_count_id,
        adjustment_date,
        adjustment_type,
        adjusted_by,
        plant_id,
        adjustment_remarks,
        adjustment_remarks2,
        adjustment_remarks3,
        reference_documents,
        stock_adjustment,
        balance_index,
        table_index,
      } = data;

      const sa = {
        stock_adjustment_status: "Draft",
        organization_id,
        stock_count_id,
        adjustment_no,
        adjustment_date,
        adjustment_type,
        adjusted_by,
        plant_id,
        adjustment_remarks,
        adjustment_remarks2,
        adjustment_remarks3,
        reference_documents,
        stock_adjustment,
        table_index,
        balance_index,
      };

      sa.stock_adjustment = await fillbackHeaderFields(sa);

      if (page_status === "Add") {
        const newPrefix = await generateDraftPrefix(organizationId);
        sa.adjustment_no = newPrefix;
        await db.collection("stock_adjustment").add(sa);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db
          .collection("stock_adjustment")
          .doc(stockAdjustmentId)
          .update(sa);
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
