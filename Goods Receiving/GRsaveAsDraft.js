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

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, grLineItem] of entry.table_gr.entries()) {
      grLineItem.supplier_id = entry.supplier_name || null;
      grLineItem.organization_id = entry.organization_id;
      grLineItem.plant_id = entry.plant_id || null;
      grLineItem.billing_state_id = entry.billing_address_state || null;
      grLineItem.billing_country_id = entry.billing_address_country || null;
      grLineItem.shipping_state_id = entry.shipping_address_state || null;
      grLineItem.shipping_country_id = entry.shipping_address_country || null;
      grLineItem.assigned_to = entry.assigned_to || null;
      grLineItem.line_index = index + 1;
    }
    return entry.table_gr;
  } catch (error) {
    throw new Error("Error processing goods receiving.");
  }
};

const generateDraftPrefix = async (entry) => {
  try {
    let currentPrefix = entry.gr_no;
    let organizationID = entry.organization_id;
    const status = "Draft";
    let documentTypes = "Goods Receiving";
    console.log("currentPrefix", currentPrefix);
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
        .collection("goods_receiving")
        .where({ gr_no: currentPrefix, organization_id: organizationID })
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
    this.showLoading("Saving Goods Receiving...");
    const data = this.getValues();
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "gr_no", label: "Goods Receiving No" },
      {
        name: "table_gr",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");
      const goodsReceivingId = this.getValue("id");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      let entry = data;
      entry.gr_status = "Draft";

      await fillbackHeaderFields(entry);

      if (page_status === "Add") {
        entry.gr_no = await generateDraftPrefix(entry);
        await db.collection("goods_receiving").add(entry);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        entry.gr_no = await generateDraftPrefix(entry);
        await db
          .collection("goods_receiving")
          .doc(goodsReceivingId)
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
