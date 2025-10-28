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

const validateField = (value, _field) => {
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
      document_types: "Transfer Order",
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
      const newPrefix = `DRAFT-${prefixData.prefix_value}-` + currDraftNum;

      db.collection("prefix_configuration")
        .where({
          document_types: "Transfer Order",
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

const fillbackHeaderFields = async (to) => {
  try {
    for (const [index, toLineItem] of to.table_to.entries()) {
      toLineItem.customer_id = to.customer_name || [];
      toLineItem.organization_id = to.organization_id;
      toLineItem.plant_id = to.plant_id || null;
      toLineItem.assigned_to = to.assigned_to || null;
      toLineItem.line_index = index + 1;
    }
    return to.table_to;
  } catch {
    throw new Error("Error processing transfer order.");
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = this.getValues();

    // Get page status and transfer order ID
    const page_status = data.page_status;
    const toId = data.id;

    // Define required fields
    const requiredFields = [
      { name: "so_id", label: "SO Number" },
      {
        name: "table_to",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      // Store previous temporary quantities if available
      if (Array.isArray(data.table_to)) {
        data.table_to.forEach((item) => {
          item.prev_temp_qty_data = item.temp_qty_data;
        });
      }

      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      // Prepare transfer order object
      const to = {
        to_status: "Draft",
        so_id: data.so_id,
        so_no: data.so_no,
        plant_id: data.plant_id,
        organization_id: organizationId,
        from_convert: "",

        to_no: data.to_no,
        to_ref_doc: data.to_ref_doc,
        customer_name: data.customer_name,

        document_description: data.document_description,
        to_delivery_method: data.to_delivery_method,
        to_date: data.to_date,
        assigned_to: data.assigned_to,

        driver_name: data.driver_name,
        driver_contact_no: data.driver_contact_no,
        ic_no: data.ic_no,
        validity_of_collection: data.validity_of_collection,
        vehicle_no: data.vehicle_no,
        pickup_date: data.pickup_date,

        courier_company: data.courier_company,
        shipping_date: data.shipping_date,
        freight_charges: data.freight_charges,
        tracking_number: data.tracking_number,
        est_arrival_date: data.est_arrival_date,

        driver_cost: data.driver_cost,
        est_delivery_date: data.est_delivery_date,

        shipping_company: data.shipping_company,
        shipping_method: data.shipping_method,

        tpt_vehicle_number: data.tpt_vehicle_number,
        tpt_transport_name: data.tpt_transport_name,
        tpt_ic_no: data.tpt_ic_no,
        tpt_driver_contact_no: data.tpt_driver_contact_no,

        table_to: data.table_to,
        order_remark: data.order_remark,
        order_remark2: data.order_remark2,
        order_remark3: data.order_remark3,

        to_total: parseFloat(data.to_total.toFixed(3)),
        reference_type: data.reference_type,
        to_created_by: data.to_created_by,
      };

      // Clean up undefined/null values
      Object.keys(to).forEach((key) => {
        if (to[key] === undefined || to[key] === null) {
          delete to[key];
        }
      });

      await fillbackHeaderFields(to);

      // Add or update based on page status
      if (page_status === "Add") {
        const newPrefix = await generateDraftPrefix(organizationId);
        to.to_no = newPrefix;
        await db.collection("picking_plan").add(to);
        this.$message.success("Add successfully");
        closeDialog();
      } else if (page_status === "Edit") {
        await db.collection("picking_plan").doc(toId).update(to);
        this.$message.success("Update successfully");
        closeDialog();
      } else {
        console.log("Unknown page status:", page_status);
        this.hideLoading();
        this.$message.error("Invalid page status");
        return;
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.hideLoading();
    this.$message.error(
      error.message ||
        "An error occurred while processing the transfer order draft"
    );
  } finally {
    console.log("Draft function execution completed");
  }
})();
