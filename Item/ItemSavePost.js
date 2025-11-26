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
      document_types: "Items",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();

  const prefixData = await prefixEntry.data[0];

  return prefixData;
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Items",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
  } catch (error) {
    this.$message.error(error);
  }
};

const generatePrefix = (runNumber, now, prefixData) => {
  let generated = prefixData.current_prefix_config;
  generated = generated.replace("prefix", prefixData.prefix_value);
  generated = generated.replace("suffix", prefixData.suffix_value);
  generated = generated.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0")
  );
  generated = generated.replace("day", String(now.getDate()).padStart(2, "0"));
  generated = generated.replace("year", now.getFullYear());
  generated = generated.replace(
    "running_number",
    String(runNumber).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("Item")
    .where({ material_code: generatedPrefix })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    this.$message.error(
      "Could not generate a unique Item number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
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

    return obj.toString();
  }
  return null;
};

const validateFormula = async (entry) => {
  const successFormula = await this.getValue("success_formula");
  const formula = entry.formula;

  if (formula) {
    if (!successFormula || (successFormula && formula !== successFormula)) {
      if (formula !== successFormula) {
        await this.$alert(
          `The entered formula is not validate yet. Please validate or clear the formula.`,
          "Unvalidated Formula Detected",
          {
            confirmButtonText: "Ok",
            type: "error",
          }
        );

        throw new Error("Error processing formula.");
      }
    }
  }
};

const validateUOMConversion = async (entry) => {
  const uomConversion = entry.table_uom_conversion;

  const latestConversion = uomConversion.filter(
    (item) => item.alt_uom_id !== ""
  );

  console.log("latestConversion", latestConversion);

  const hasInvalidAltQty = latestConversion.filter(
    (item, index) => (item.alt_qty === 1 || item.alt_qty === 0) && index !== 0
  );

  if (hasInvalidAltQty.length > 0) {
    await this.$alert(
      "Invalid Alt Qty. Alt Qty must be not equal to 0 or 1.",
      "Invalid Alt Qty",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );
    throw new Error("Invalid UOM Conversion");
  }

  entry.table_uom_conversion = latestConversion;

  return entry;
};

const findMissingPriceLine = async (table, name) => {
  console.log("table", table);
  const lineData = table.filter(
    (item) =>
      (!item[`${name.tableName}_id`] || item[`${name.tableName}_id`] === "") &&
      (!item[`${name.fieldName}_price_tag_id`] ||
        item[`${name.fieldName}_price_tag_id`] === "")
  );

  return lineData;
};

const findDuplicatePriceLine = async (table, name) => {
  return table.filter(
    (item) =>
      item[`${name.tableName}_id`] &&
      item[`${name.tableName}_id`] !== "" &&
      item[`${name.fieldName}_price_tag_id`] &&
      item[`${name.fieldName}_price_tag_id`] !== ""
  );
};

const checkValidDateInput = async (table, name) => {
  const invalidDateLine = table.filter((item) => {
    const dateFrom = item[`${name.fieldName}_price_date_from`];
    const dateTo = item[`${name.fieldName}_price_date_to`];

    // If both dates have values, check if to > from
    if (dateFrom && dateTo) {
      return new Date(dateFrom) >= new Date(dateTo);
    }

    // If either one is missing, ignore (return false to exclude from invalidDateLine)
    return false;
  });

  return invalidDateLine;
};
const validatePricingDetail = async (groupedPriceLine, name) => {
  let errors = [];
  Object.values(groupedPriceLine).forEach((group) => {
    for (let i = 0; i < group.length; i++) {
      // checking quantity
      const currentItem = group[i];
      console.log("currentItem", currentItem);
      for (let j = i + 1; j < group.length; j++) {
        const comparedItem = j !== i ? group[j] : null;

        if (!comparedItem) {
          continue;
        }

        const currentFrom = currentItem[`${name.fieldName}_price_date_from`];
        const currentTo = currentItem[`${name.fieldName}_price_date_to`];
        const comparedFrom = comparedItem[`${name.fieldName}_price_date_from`];
        const comparedTo = comparedItem[`${name.fieldName}_price_date_to`];

        // If any date is null, treat it as infinity (no boundary)
        const from1 = !currentFrom ? -Infinity : new Date(currentFrom);
        const to1 = !currentTo ? Infinity : new Date(currentTo);
        const from2 = !comparedFrom ? -Infinity : new Date(comparedFrom);
        const to2 = !comparedTo ? Infinity : new Date(comparedTo);

        const datesOverlap = from1 <= to2 && to1 >= from2;

        if (datesOverlap) {
          const currentMinQty =
            currentItem[`${name.fieldName}_min_order_qty`] || 0;
          const currentMaxQty =
            currentItem[`${name.fieldName}_max_order_qty`] || 0;
          const comparedMinQty =
            comparedItem[`${name.fieldName}_min_order_qty`] || 0;
          const comparedMaxQty =
            comparedItem[`${name.fieldName}_max_order_qty`] || 0;

          const min1 =
            !currentMinQty || currentMinQty === 0 ? -Infinity : currentMinQty;
          const max1 =
            !currentMaxQty || currentMaxQty === 0 ? Infinity : currentMaxQty;
          const min2 =
            !comparedMinQty || comparedMinQty === 0
              ? -Infinity
              : comparedMinQty;
          const max2 =
            !comparedMaxQty || comparedMaxQty === 0 ? Infinity : comparedMaxQty;

          const quantityOverlap = min1 <= max2 && max1 >= min2;

          if (quantityOverlap) {
            errors.push({
              type: "Quantity Range Overlap",
              message: `Overlapping quantity ranges within the same date found for table ${
                name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
              } Line ${i + 1} and Line ${j + 1}`,
              details: `[Min: ${currentMinQty}, Max: ${currentMaxQty}] vs [Min: ${comparedMinQty}, Max: ${comparedMaxQty}]`,
            });
          }
        }
      }

      // checking unit price
      const unitPrice = currentItem[`${name.fieldName}_price_unit_price`];
      const minPrice = currentItem[`${name.fieldName}_price_min_price`];
      const maxPrice = currentItem[`${name.fieldName}_price_max_price`];

      if (minPrice && minPrice > 0 && unitPrice < minPrice) {
        errors.push({
          type: "Unit Price Less Than Min Price",
          message: `Unit price is less than minimum price for table ${
            name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
          } Line ${i + 1}`,
          details: `[Unit Price: ${unitPrice}, Min Price: ${minPrice}]`,
        });
      }

      if (maxPrice && maxPrice > 0 && unitPrice > maxPrice) {
        errors.push({
          type: "Unit Price Greater Than Max Price",
          message: `Unit price is greater than maximum price for table ${
            name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
          } Line ${i + 1}`,
          details: `[Unit Price: ${unitPrice}, Max Price: ${maxPrice}]`,
        });
      }
    }
  });

  return errors;
};

const validatePurchaseAndSalesInformation = async (entry) => {
  const fieldNameList = [
    {
      tableName: "supplier",
      fieldName: "sup",
    },
    {
      tableName: "customer",
      fieldName: "cust",
    },
  ];

  for (const name of fieldNameList) {
    const priceTable = entry[`table_${name.tableName}_price`];
    const accessTable = entry[`table_${name.fieldName}_item_access`];

    console.log("priceTable", priceTable);
    console.log("accessTable", accessTable);

    // checking valid line data
    const missingPriceLine = await findMissingPriceLine(priceTable, name);

    const missingAccessLine = await findMissingPriceLine(accessTable, name);

    if (missingPriceLine.length > 0 || missingAccessLine.length > 0) {
      await this.$alert(
        `Please fill in all ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } price lines.`,
        `Missing ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Price Line`,
        {
          confirmButtonText: "OK",
          type: "error",
        }
      );
      throw new Error(
        `Missing ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Price Line`
      );
    }

    const duplicatePriceAccess = await findDuplicatePriceLine(
      accessTable,
      name
    );

    const duplicatePriceLine = await findDuplicatePriceLine(priceTable, name);

    if (duplicatePriceAccess.length > 0 || duplicatePriceLine.length > 0) {
      await this.$alert(
        `Please fill in either <em>${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Code</em> or <em>${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Price Tag</em> <strong>ONLY</strong>.`,
        "Duplicate Input",
        {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        }
      );
      throw new Error("Duplicate Input");
    }

    const invalidDateLine = await checkValidDateInput(priceTable, name);

    if (invalidDateLine.length > 0) {
      await this.$alert(
        `Please fill in valid date range for ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } price lines.`,
        "Invalid Date Input",
        {
          confirmButtonText: "OK",
          type: "error",
        }
      );
      console.log("invalidDateLine", invalidDateLine);
      throw new Error("Invalid Date Input");
    }

    // checking quantity
    const groupedPriceLine = priceTable.reduce((acc, item) => {
      const hasID =
        item[`${name.tableName}_id`] && item[`${name.tableName}_id`] !== "";
      const hasPriceTagID =
        item[`${name.fieldName}_price_tag_id`] &&
        item[`${name.fieldName}_price_tag_id`] !== "";

      let key;

      if (hasID) {
        key = `${name.tableName}_${item[`${name.tableName}_id`]}`;
      } else if (hasPriceTagID) {
        key = `${name.fieldName}_price_tag_${
          item[`${name.fieldName}_price_tag_id`]
        }`;
      } else {
        key = "no_id"; // Handle items with no ID
      }

      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);

      return acc;
    }, {});

    console.log("groupedPriceLine", groupedPriceLine);

    const errors = await validatePricingDetail(groupedPriceLine, name);
    console.log("errors", errors);
    if (errors.length > 0) {
      await this.$alert(
        `<strong>Error in ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Price Line:</strong><br> ${errors
          .map((e) => e.message)
          .join("<br>")}<br><br><strong>Details:</strong><br>${errors
          .map((e) => e.details)
          .join("<br>")}`,
        `Invalid Data in ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Price Line`,
        {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        }
      );
      throw new Error(
        `Invalid Data in ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Price Line`
      );
    }
  }
};

(async () => {
  try {
    this.showLoading();

    const data = this.getValues();

    const page_status = data.page_status;
    const item_no = data.id;

    // Define required fields
    const requiredFields = [
      { name: "material_type", label: "Item Type" },
      { name: "material_name", label: "Item Name" },
      { name: "material_code", label: "Item Code" },
      { name: "item_category", label: "Item Category" },
      { name: "based_uom", label: "Based UOM" },
    ];

    const missingFields = await validateForm(data, requiredFields);

    await this.validate("material_code");

    if (missingFields.length === 0) {
      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      // Prepare entry data
      let entry = {
        is_active: data.is_active,
        item_image: data.item_image,
        material_type: data.material_type,
        organization_id: organizationId,
        material_code: data.material_code,
        material_name: data.material_name,
        item_category: data.item_category,
        material_sub_category: data.material_sub_category,
        material_desc: data.material_desc,
        material_costing_method: data.material_costing_method,
        stock_control: data.stock_control,
        show_delivery: data.show_delivery,
        show_receiving: data.show_receiving,
        based_uom: data.based_uom,
        item_properties: data.item_properties,
        business_scope: data.business_scope,
        table_uom_conversion: data.table_uom_conversion,
        purchase_tariff_id: data.purchase_tariff_id,
        mat_purchase_currency_id: data.mat_purchase_currency_id,
        mat_purchase_tax_id: data.mat_purchase_tax_id,
        purchase_tax_percent: data.purchase_tax_percent,
        purchase_unit_price: data.purchase_unit_price,
        sales_tariff_id: data.sales_tariff_id,
        mat_sales_tax_id: data.mat_sales_tax_id,
        sales_tax_percent: data.sales_tax_percent,
        mat_sales_currency_id: data.mat_sales_currency_id,
        sales_unit_price: data.sales_unit_price,
        item_batch_management: data.item_batch_management,
        batch_number_genaration:
          data.batch_number_genaration || "According To System Settings",
        serial_number_management: data.serial_number_management,
        is_single_unit_serial: data.is_single_unit_serial,
        serial_no_generate_rule: data.serial_no_generate_rule,
        brand_id: data.brand_id,
        brand_artwork_id: data.brand_artwork_id,
        subform_packaging_remark: data.subform_packaging_remark,
        reorder_level: data.reorder_level,
        lead_time: data.lead_time,
        assembly_cost: data.assembly_cost,
        bom_related: data.bom_related,
        reorder_quantity: data.reorder_quantity,
        irbm_id: data.irbm_id,
        production_time: data.production_time,
        additional_remark: data.additional_remark,
        over_receive_tolerance: data.over_receive_tolerance,
        under_receive_tolerance: data.under_receive_tolerance,
        over_delivery_tolerance: data.over_delivery_tolerance,
        under_delivery_tolerance: data.under_delivery_tolerance,
        posted_status: "Pending Post",
        barcode_number: data.barcode_number,
        purchase_default_uom: data.purchase_default_uom,
        sales_default_uom: data.sales_default_uom,
        receiving_inspection: data.receiving_inspection,
        table_default_bin: data.table_default_bin,
        is_base: data.is_base,
        last_transaction_date: data.last_transaction_date,
        min_sales_qty: data.min_sales_qty,
        min_purchase_qty: data.min_purchase_qty,
        formula: data.formula,
        table_sup_item_access: data.table_sup_item_access,
        table_supplier_price: data.table_supplier_price,
        table_cust_item_access: data.table_cust_item_access,
        table_customer_price: data.table_customer_price,
      };

      await validateFormula(entry);
      entry = await validateUOMConversion(entry);
      await validatePurchaseAndSalesInformation(entry);
      console.log("entry", entry);

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        try {
          if (entry.material_code === data.item_current_prefix) {
            const prefixData = await getPrefixData(organizationId);

            if (prefixData.length !== 0) {
              const { prefixToShow, runningNumber } = await findUniquePrefix(
                prefixData
              );

              await updatePrefix(organizationId, runningNumber);

              entry.material_code = prefixToShow;
            }
          }

          await db.collection("Item").add(entry);
        } catch (error) {
          console.error("Error adding item:", error);
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while adding the item."
          );
        }
      } else if (page_status === "Edit") {
        try {
          // Update the existing item
          if (!item_no) {
            throw new Error("Item ID not found");
          }

          await db.collection("Item").doc(item_no).update(entry);
        } catch (error) {
          console.error("Error updating item:", error);
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while updating the item."
          );
        }
      } else {
        this.hideLoading();
        this.$message.error("Invalid page status");
      }

      if (organizationId) {
        const resAI = await db
          .collection("accounting_integration")
          .where({ organization_id: organizationId })
          .get();

        if (resAI && resAI.data.length > 0) {
          const aiData = resAI.data[0];

          if (aiData.acc_integration_type === "SQL Accounting") {
            // Run SQL workflow
            console.log("Calling SQL Accounting workflow");
            // Run health check
            await this.runWorkflow(
              "1958732352162164738",
              { key: "value" },
              async (res) => {
                console.log("成功结果：", res);
                if (res.data.status === "running") {
                  // Run workflow
                  await this.runWorkflow(
                    "1906666085143818241",
                    { key: "value" },
                    (res) => {
                      console.log("成功结果：", res);
                      this.$message.success("Save item successfully.");
                      closeDialog();
                    },
                    (err) => {
                      console.error("失败结果：", err);
                      this.hideLoading();
                      throw new Error(
                        "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
                      );
                    }
                  );
                }
              },
              (err) => {
                console.log("失败结果：", err);

                this.hideLoading();
                throw new Error(
                  "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
                );
              }
            );
          } else if (aiData.acc_integration_type === "AutoCount Accounting") {
            await this.runWorkflow(
              // "1970722955815616514",
              "1991400333408145410",
              { key: "value" },
              (res) => {
                console.log("成功结果：", res);
                this.$message.success("Save item successfully.");
                closeDialog();
              },
              (err) => {
                console.error("失败结果：", err);
                this.hideLoading();
                throw new Error(
                  "Your AutoCount accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
                );
              }
            );
            console.log("Calling AutoCount workflow");
          } else if (
            aiData.acc_integration_type === "No Accounting Integration"
          ) {
            await closeDialog();
            console.log("Not calling workflow");
          } else {
            await closeDialog();
          }
        }
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();

    console.error(error);
    // Try to get message from standard locations first
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
