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
    const tablePO = entry.table_po;

    const uniqueItemIds = [
      ...new Set(
        tablePO.filter((item) => item.item_id).map((item) => item.item_id)
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
    for (const [index, poLineItem] of entry.table_po.entries()) {
      poLineItem.supplier_id = entry.po_supplier_id || null;
      poLineItem.plant_id = entry.po_plant || null;
      poLineItem.payment_term_id = entry.po_payment_terms || null;
      poLineItem.shipping_preference_id = entry.po_shipping_preference || null;
      poLineItem.billing_state_id = entry.billing_address_state || null;
      poLineItem.billing_country_id = entry.billing_address_country || null;
      poLineItem.shipping_state_id = entry.shipping_address_state || null;
      poLineItem.shipping_country_id = entry.shipping_address_country || null;
      poLineItem.preq_id = entry.preq_id || null;
      poLineItem.line_index = index + 1;
      poLineItem.organization_id = entry.organization_id;
      poLineItem.line_status = entry.po_status;
      poLineItem.po_created_by = this.getVarGlobal("nickname");
    }
    return entry.table_po;
  } catch (error) {
    throw new Error("Error processing purchase order.");
  }
};

const generateDraftPrefix = async (entry) => {
  try {
    let currentPrefix = entry.purchase_order_no;
    let organizationID = entry.organization_id;
    const status = "Draft";
    let documentTypes = "Purchase Orders";

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
        .collection("purchase_order")
        .where({
          purchase_order_no: currentPrefix,
          organization_id: organizationID,
        })
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
    this.showLoading("Saving Purchase Orders...");
    const data = this.getValues();
    const requiredFields = [
      { name: "po_plant", label: "Plant" },
      { name: "purchase_order_no", label: "PO Number" },
      {
        name: "table_po",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = data.page_status;
      const purchaseOrderId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      let entry = data;
      entry.po_status = "Draft";

      if (
        (!entry.partially_received || entry.partially_received === "") &&
        (!entry.fully_received || entry.fully_received === "")
      ) {
        const lineItemLength = entry.table_po.length;

        entry.partially_received = `0 / ${lineItemLength}`;
        entry.fully_received = `0 / ${lineItemLength}`;
      }

      entry.table_po = await fillbackHeaderFields(entry);

      if (page_status === "Add" || page_status === "Clone") {
        entry.purchase_order_no = await generateDraftPrefix(entry);
        await db.collection("purchase_order").add(entry);
        this.$message.success("Add successfully");
      } else if (page_status === "Edit") {
        entry.purchase_order_no = await generateDraftPrefix(entry);

        await db
          .collection("purchase_order")
          .doc(purchaseOrderId)
          .update(entry);
        this.$message.success("Update successfully");
      }

      await updateItemTransactionDate(entry);
      closeDialog();
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error.message || String(error));
  }
})();
