const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const getPrefixData = async (organizationId, documentType = "Packing") => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: documentType,
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    console.log("Prefix data result:", prefixEntry);

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      console.log("No prefix configuration found");
      return null;
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error getting prefix data:", error);
    throw error;
  }
};

const updatePrefix = async (
  organizationId,
  runningNumber,
  documentType = "Packing"
) => {
  console.log(
    "Updating prefix for organization:",
    organizationId,
    "with running number:",
    runningNumber
  );
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: documentType,
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({
        running_number: parseInt(runningNumber) + 1,
        has_record: 1,
      });
    console.log("Prefix update successful");
  } catch (error) {
    console.error("Error updating prefix:", error);
    throw error;
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  console.log("Generating prefix with running number:", runNumber);
  try {
    let generated = prefixData.current_prefix_config;
    generated = generated.replace("prefix", prefixData.prefix_value);
    generated = generated.replace("suffix", prefixData.suffix_value);
    generated = generated.replace(
      "month",
      String(now.getMonth() + 1).padStart(2, "0")
    );
    generated = generated.replace(
      "day",
      String(now.getDate()).padStart(2, "0")
    );
    generated = generated.replace("year", now.getFullYear());
    generated = generated.replace(
      "running_number",
      String(runNumber).padStart(prefixData.padding_zeroes, "0")
    );
    console.log("Generated prefix:", generated);
    return generated;
  } catch (error) {
    console.error("Error generating prefix:", error);
    throw error;
  }
};

const checkUniqueness = async (
  generatedPrefix,
  organizationId,
  collection = "packing",
  prefix = "packing_no"
) => {
  const existingDoc = await db
    .collection(collection)
    .where({
      [prefix]: generatedPrefix,
      organization_id: organizationId,
      is_deleted: 0,
    })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (
  prefixData,
  organizationId,
  collection = "packing",
  prefix = "packing_no"
) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(
      prefixToShow,
      organizationId,
      collection,
      prefix
    );
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Packing number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const validateForm = (data, requiredFields) => {
  const missingFields = [];

  requiredFields.forEach((field) => {
    const value = data[field.name];

    // Handle non-array fields (unchanged)
    if (!field.isArray) {
      if (validateField(value)) {
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
          if (validateField(subValue)) {
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

const validateField = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return value <= 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const addEntry = async (organizationId, packingData) => {
  try {
    const prefixData = await getPrefixData(organizationId, "Packing");

    if (prefixData) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId,
        "packing",
        "packing_no"
      );

      await updatePrefix(organizationId, runningNumber, "Packing");
      packingData.packing_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        packingData.packing_no,
        organizationId,
        "packing",
        "packing_no"
      );
      if (!isUnique) {
        throw new Error(
          `Packing Number "${packingData.packing_no}" already exists. Please use a different number.`
        );
      }
    }

    // Add the record
    const createdRecord = await db.collection("packing").add(packingData);

    if (!createdRecord.data || createdRecord.data.length === 0) {
      throw new Error("Failed to retrieve created packing record");
    }

    const packingId = createdRecord.data[0].id;
    console.log("Packing created successfully with ID:", packingId);
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (
  organizationId,
  packingData,
  packingId,
  originalPackingStatus
) => {
  try {
    if (originalPackingStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId, "Packing");

      if (prefixData) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId,
          "packing",
          "packing_no"
        );

        await updatePrefix(organizationId, runningNumber, "Packing");
        packingData.packing_no = prefixToShow;
      } else {
        const isUnique = await checkUniqueness(
          packingData.packing_no,
          organizationId,
          "packing",
          "packing_no"
        );
        if (!isUnique) {
          throw new Error(
            `Packing Number "${packingData.packing_no}" already exists. Please use a different number.`
          );
        }
      }
    }

    await db.collection("packing").doc(packingId).update(packingData);

    console.log("Packing updated successfully");
    return packingId;
  } catch (error) {
    console.error("Error in updateEntry:", error);
    throw error;
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

const headerCalculation = (data) => {
  const packingMode = data.packing_mode;
  const tableHU = data.table_hu || [];
  const tableItems = data.table_items || [];

  // Calculate total item quantity (with safety checks)
  data.total_item_qty = tableItems.reduce(
    (total, item) => total + (parseFloat(item.quantity) || 0),
    0
  );

  // Calculate total HU count based on packing mode
  if (packingMode === "Basic") {
    data.total_hu_count = tableHU.reduce(
      (total, item) => total + (parseInt(item.hu_quantity) || 0),
      0
    );
  } else {
    data.total_hu_count = tableHU.length;
  }

  // Count unique item codes (efficient approach)
  data.total_item_count = new Set(
    tableItems.map((item) => item.item_code).filter(Boolean)
  ).size;

  return data;
};

const updateSOStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      //filter duplicated so_id
      const uniqueSOIds = [...new Set(tableItems.map((item) => item.so_id))];

      //filter duplicated so_line_id
      const uniqueSOLineIds = [
        ...new Set(tableItems.map((item) => item.so_line_id)),
      ];

      //update so status
      for (const soId of uniqueSOIds) {
        await db.collection("sales_order_axszx8cj_sub").doc(soId).update({
          packing_status: "Created",
        });
      }

      //update so_line status
      for (const soLineId of uniqueSOLineIds) {
        await db.collection("sales_order_line").doc(soLineId).update({
          packing_status: "Created",
        });
      }
    }
  } catch (error) {
    console.error("Error updating SO status:", error);
    throw error;
  }
};

const updateGDStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      //filter duplicated gd_id
      const uniqueGDIds = [...new Set(tableItems.map((item) => item.gd_id))];

      //filter duplicated gd_line_id
      const uniqueGDLineIds = [
        ...new Set(tableItems.map((item) => item.gd_line_id)),
      ];

      //update gd status
      for (const gdId of uniqueGDIds) {
        await db.collection("good_delivery").doc(gdId).update({
          packing_status: "Created",
        });
      }

      //update gd_line status
      for (const gdLineId of uniqueGDLineIds) {
        await db
          .collection("goods_delivery_fwii8mvb_sub")
          .doc(gdLineId)
          .update({
            packing_status: "Created",
          });
      }
    }
  } catch (error) {
    console.error("Error updating GD status:", error);
    throw error;
  }
};

const updateTOStatus = async (data) => {
  try {
    const tableItems = data.table_items || [];
    const packingMode = data.packing_mode;

    if (packingMode === "Basic") {
      //filter duplicated to_id
      const uniqueTOIds = [...new Set(tableItems.map((item) => item.to_id))];

      //filter duplicated to_line_id
      const uniqueTOLineIds = [
        ...new Set(tableItems.map((item) => item.to_line_id)),
      ];

      //update to status
      for (const toId of uniqueTOIds) {
        await db.collection("picking_plan").doc(toId).update({
          packing_status: "Created",
        });
      }

      //update to_line status
      for (const toLineId of uniqueTOLineIds) {
        await db.collection("picking_plan_fwii8mvb_sub").doc(toLineId).update({
          packing_status: "Created",
        });
      }
    }
  } catch (error) {
    console.error("Error updating TO status:", error);
    throw error;
  }
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const page_status = data.page_status;
    const originalPackingStatus = data.packing_status;

    console.log(
      `Page Status: ${page_status}, Original Packing Status: ${originalPackingStatus}`
    );

    // Define required fields
    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "packing_no", label: "Packing No" },
      {
        name: "table_hu",
        label: "Handling Unit Table",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length > 0) {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
      return;
    }

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // Prepare packing object
    let packingData = {
      packing_status: "Created",
      plant_id: data.plant_id,
      packing_no: data.packing_no,
      so_no: data.so_no,
      gd_no: data.gd_no,
      so_id: data.so_id,
      gd_id: data.gd_id,
      to_id: data.to_id,
      customer_id: data.customer_id,
      billing_address: data.billing_address,
      shipping_address: data.shipping_address,
      organization_id: organizationId,
      packing_mode: data.packing_mode,
      packing_location: data.packing_location,
      assigned_to: data.assigned_to,
      created_by: this.getVarGlobal("userId"),
      ref_doc: data.ref_doc,
      table_hu: data.table_hu,
      table_items: data.table_items,
      remarks: data.remarks,
    };

    // Add created_at only for new records
    if (page_status === "Add") {
      packingData.created_at =
        data.created_at || new Date().toISOString().split("T")[0];
    }

    // Clean up undefined/null values
    Object.keys(packingData).forEach((key) => {
      if (packingData[key] === undefined || packingData[key] === null) {
        delete packingData[key];
      }
    });

    // Calculate header totals after cleanup
    packingData = headerCalculation(packingData);

    let packingId;

    // Perform action based on page status
    if (page_status === "Add") {
      await addEntry(organizationId, packingData);
    } else if (page_status === "Edit") {
      packingId = data.id;
      await updateEntry(
        organizationId,
        packingData,
        packingId,
        originalPackingStatus
      );
    }

    if (originalPackingStatus === "Draft") {
      if (packingData.so_id && packingData.so_id !== "") {
        await updateSOStatus(packingData);
      }
      if (packingData.gd_id && packingData.gd_id !== "") {
        await updateGDStatus(packingData);
      }
      if (packingData.to_id && packingData.to_id !== "") {
        await updateTOStatus(packingData);
      }
    }

    this.$message.success(
      `${page_status === "Add" ? "Added" : "Updated"} successfully`
    );

    this.hideLoading();
    closeDialog();
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
