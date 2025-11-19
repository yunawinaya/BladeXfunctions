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

const updateItemTransactionDate = async (entry) => {
  try {
    const tableSO = entry.table_so;

    const uniqueItemIds = [
      ...new Set(
        tableSO.filter((item) => item.item_name).map((item) => item.item_name)
      ),
    ];

    const date = new Date().toISOString();
    for (const [index, item] of uniqueItemIds.entries()) {
      try {
        await db
          .collection("Item")
          .doc(item)
          .update({ last_transaction_date: date });
      } catch (error) {
        throw new Error(
          `Cannot update last transaction date for item #${index + 1}.`
        );
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, soLineItem] of entry.table_so.entries()) {
      soLineItem.plant_id = entry.plant_name || null;
      soLineItem.customer_id = entry.customer_name || null;
      soLineItem.payment_term_id = entry.so_payment_term || null;
      soLineItem.sales_person_id = entry.so_sales_person || null;
      soLineItem.billing_state_id = entry.billing_address_state || null;
      soLineItem.billing_country_id = entry.billing_address_country || null;
      soLineItem.shipping_state_id = entry.shipping_address_state || null;
      soLineItem.shipping_country_id = entry.shipping_address_country || null;
      soLineItem.line_index = index + 1;
      soLineItem.organization_id = entry.organization_id;
      soLineItem.line_status = entry.so_status;
      soLineItem.access_group = entry.access_group || [];
    }
    return entry.table_so;
  } catch (error) {
    throw new Error("Error processing sales order.");
  }
};

const generateDraftPrefix = async (entry) => {
  try {
    let currentPrefix = entry.so_no;
    let organizationID = entry.organization_id;
    const status = "Draft";
    let documentTypes = "Sales Orders";

    if (currentPrefix === "<<new>>") {
      const workflowResult = await new Promise((resolve, reject) => {
        this.runWorkflow(
          "1984071042628268034",
          {
            document_type: documentTypes,
            organization_id: organizationID,
            document_no_id: "",
            status: status,
          },
          (res) => resolve(res),
          (err) => reject(err)
        );
      });

      console.log("res", workflowResult);
      const result = workflowResult.data;

      if (result.is_unique === "TRUE") {
        currentPrefix = result.doc_no;
        console.log("result", result.doc_no);
      } else {
        currentPrefix = result.doc_no;
        throw new Error(
          `${documentTypes} Number "${currentPrefix}" already exists. Please reset the running number.`
        ); // Specific error
      }
    } else {
      const id = entry.id || "";
      const checkUniqueness = await db
        .collection("sales_order")
        .where({ so_no: currentPrefix, organization_id: organizationID })
        .get();

      if (checkUniqueness.data.length > 0) {
        if (checkUniqueness.data[0].id !== id) {
          throw new Error(
            `${documentTypes} Number "${currentPrefix}" already exists. Please use a different number.`
          );
        }
      }
    }

    return currentPrefix;
  } catch (error) {
    await this.$alert(error.toString(), "Error", {
      confirmButtonText: "OK",
      type: "error",
    });
    this.hideLoading();
    throw error;
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading("Saving Sales Order...");
    const data = this.getValues();

    // Get page status and sales order ID
    const page_status = data.page_status;
    const sales_order_id = data.id;

    // Define required fields
    const requiredFields = [
      { name: "plant_name", label: "Plant" },
      { name: "so_no", label: "SO Number" },
      {
        name: "table_so",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      let entry = data;
      entry.so_status = "Draft";

      entry.table_so = await entry;

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        entry.so_no = await generateDraftPrefix(entry);
        await db.collection("sales_order").add(entry);
        this.$message.success("Add successfully");
      } else if (page_status === "Edit") {
        entry.so_no = await generateDraftPrefix(entry);
        await db.collection("sales_order").doc(sales_order_id).update(entry);
        this.$message.success("Update successfully");
      } else {
        console.log("Unknown page status:", page_status);
        this.hideLoading();
        this.$message.error("Invalid page status");
        return;
      }

      await updateItemTransactionDate(entry);
      await closeDialog();
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.hideLoading();
    this.$message.error(
      error.message ||
        "An error occurred while processing the sales order draft"
    );
  } finally {
    console.log("Draft function execution completed");
  }
})();
