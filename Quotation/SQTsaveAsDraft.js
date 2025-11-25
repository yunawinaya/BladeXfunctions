// Save as Draft Button onClick Handler
const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const fillbackHeaderFields = async (entry) => {
  let customerName = "";
  if (entry.customer_type === "Existing Customer") {
    const resCustomer = await db
      .collection("Customer")
      .doc(entry.sqt_customer_id)
      .get();

    if (resCustomer && resCustomer.data.length > 0)
      customerName = resCustomer.data[0].customer_com_name;
  } else {
    customerName = entry.sqt_new_customer;
  }
  try {
    for (const [index, sqtLineItem] of entry.table_sqt.entries()) {
      sqtLineItem.customer_id = entry.sqt_customer_id || null;
      sqtLineItem.plant_id = entry.sqt_plant || null;
      sqtLineItem.payment_term_id = entry.sqt_payment_term || null;
      sqtLineItem.sales_person_id = entry.sales_person_id || null;
      sqtLineItem.billing_state_id = entry.billing_address_state || null;
      sqtLineItem.billing_country_id = entry.billing_address_country || null;
      sqtLineItem.shipping_state_id = entry.shipping_address_state || null;
      sqtLineItem.shipping_country_id = entry.shipping_address_country || null;
      sqtLineItem.customer_name = customerName;
      sqtLineItem.line_index = index + 1;
      sqtLineItem.organization_id = entry.organization_id;
      sqtLineItem.access_group = entry.access_group || [];
    }
    return entry.table_sqt;
  } catch (error) {
    throw new Error("Error processing quotation.");
  }
};

const generateDraftPrefix = async (entry) => {
  try {
    let currentPrefix = entry.sqt_no;
    let organizationID = entry.organization_id;
    const status = "Draft";
    let documentTypes = "Quotations";

    if (currentPrefix === "<<new>>") {
      const workflowResult = await new Promise((resolve, reject) => {
        this.runWorkflow(
          "1984071042628268034",
          {
            document_type: documentTypes,
            organization_id: organizationID,
            document_no_id: "",
            status: status,
            doc_no: currentPrefix,
            prev_status: "",
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
        .collection("Quotation")
        .where({ sqt_no: currentPrefix, organization_id: organizationID })
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

(async () => {
  try {
    const data = this.getValues();
    const page_status = data.page_status;
    const quotation_no = data.id; // Get ID from form data

    // Define required fields
    const requiredFields = [
      { name: "sqt_plant", label: "Plant" },
      { name: "sqt_no", label: "Quotation Number" },
      {
        name: "table_sqt",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = requiredFields.filter((field) => {
      const value = data[field.name];

      if (Array.isArray(value)) {
        return value.length === 0;
      } else if (typeof value === "string") {
        return value.trim() === "";
      } else {
        return !value;
      }
    });

    if (missingFields.length > 0) {
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
      return;
    }

    // Show loading indicator
    this.showLoading("Saving Quotation...");

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    let entry = data;
    entry.sqt_status = "Draft";
    entry.organization_id = organizationId;
    entry.table_sqt = await fillbackHeaderFields(entry);

    if (page_status === "Add" || page_status === "Clone") {
      try {
        entry.sqt_no = await generateDraftPrefix(entry);

        // Add quotation entry
        await db.collection("Quotation").add(entry);

        // Close dialog
        await closeDialog();
      } catch (error) {
        console.error("Error saving draft:", error);
        this.hideLoading();
        this.$message.error(error.message || "Failed to save draft");
      }
    } else if (page_status === "Edit") {
      try {
        // Update existing quotation
        if (!quotation_no) {
          throw new Error("Quotation ID not found");
        }
        entry.sqt_no = await generateDraftPrefix(entry);
        await db.collection("Quotation").doc(quotation_no).update(entry);

        // Close dialog
        closeDialog();
      } catch (error) {
        console.error("Error updating draft:", error);
        this.hideLoading();
        this.$message.error(error.message || "Failed to update draft");
      }
    } else {
      this.hideLoading();
      this.$message.error("Invalid page status");
    }
  } catch (error) {
    console.error("Error in save as draft:", error);
    this.$message.error(`Cancel saving draft: ${error.toString()}`);
  }
})();
