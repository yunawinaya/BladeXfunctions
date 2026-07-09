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

const validateUOMConversion = async (entry) => {
  const uomConversion = entry.table_uom_conversion;

  const latestConversion = uomConversion.filter(
    (item) => item.alt_uom_id && item.alt_uom_id !== "",
  );

  console.log("latestConversion", latestConversion);

  const hasInvalidAltQty = latestConversion.filter(
    (item) => item.base_qty === 0,
  );

  if (hasInvalidAltQty.length > 0) {
    await this.$alert(
      "Invalid Base Qty. Base Qty must be not equal to 0.",
      "Invalid Base Qty",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    throw new Error("Invalid UOM Conversion");
  }

  entry.table_uom_conversion = latestConversion;

  return entry;
};

const validatePackingDetailUOM = async (entry) => {
  const altUOMs = new Set(
    (entry.table_uom_conversion || [])
      .map((item) => item.alt_uom_id)
      .filter((uom) => uom && uom !== ""),
  );

  const invalidLines = [];
  // A UOM may have several packing rows, but each (UOM, Packing UOM) pair must
  // be unique — documents identify a packing row by that pair.
  const seenPairs = new Set();
  const duplicateLines = [];

  (entry.table_packing_detail || []).forEach((item, index) => {
    if (item.uom_id && item.uom_id !== "" && !altUOMs.has(item.uom_id)) {
      invalidLines.push(index + 1);
    }

    if (
      item.uom_id &&
      item.uom_id !== "" &&
      item.packing_uom_id &&
      item.packing_uom_id !== ""
    ) {
      const pair = `${item.uom_id}|${item.packing_uom_id}`;
      if (seenPairs.has(pair)) {
        duplicateLines.push(index + 1);
      }
      seenPairs.add(pair);
    }
  });

  if (invalidLines.length > 0) {
    await this.$alert(
      `Invalid UOM in Packing Detail Line ${invalidLines.join(
        ", ",
      )}. Each UOM in Packing Detail must exist as an Alt UOM in UOM Conversion.`,
      "Invalid Packing Detail",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    throw new Error("Invalid UOM in Packing Detail");
  }

  if (duplicateLines.length > 0) {
    await this.$alert(
      `Duplicate Packing Detail in Line ${duplicateLines.join(
        ", ",
      )}. Each UOM can only have one row per Packing UOM.`,
      "Duplicate Packing Detail",
      {
        confirmButtonText: "OK",
        type: "error",
      },
    );
    throw new Error("Duplicate Packing Detail");
  }
};

const findMissingPriceLine = async (table, name) => {
  console.log("table", table);
  const lineData = table.filter(
    (item) =>
      (!item[`${name.tableName}_id`] || item[`${name.tableName}_id`] === "") &&
      (!item[`${name.fieldName}_price_tag_id`] ||
        item[`${name.fieldName}_price_tag_id`] === ""),
  );

  return lineData;
};

const findDuplicatePriceLine = async (table, name) => {
  return table.filter(
    (item) =>
      item[`${name.tableName}_id`] &&
      item[`${name.tableName}_id`] !== "" &&
      item[`${name.fieldName}_price_tag_id`] &&
      item[`${name.fieldName}_price_tag_id`] !== "",
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
        },
      );
      throw new Error(
        `Missing ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Price Line`,
      );
    }

    const duplicatePriceAccess = await findDuplicatePriceLine(
      accessTable,
      name,
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
        },
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
        },
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
        },
      );
      throw new Error(
        `Invalid Data in ${
          name.tableName.charAt(0).toUpperCase() + name.tableName.slice(1)
        } Price Line`,
      );
    }
  }
};

const createBOM = async (data) => {
  const autoBOM = data.auto_bom;

  if (autoBOM) {
    if (!data.bom_id || data.bom_id === "" || data.bom_id === null) {
      const resBOM = await db.collection("bom_tree").add({
        bom_level: 1,
        bom_sort: 0,
        bom_path: "/1/",
        organization_id: data.organization_id,

        is_current_version: 1,
        is_top_level: 1,
        is_active: 1,
        bom_status: "Unready",
        bom_version: "V1",
        base_quantity: 1,

        material_id: data.id,
        material_code: data.material_code,
        material_name: data.material_name,
        material_desc: data.material_desc,
        category: data.item_category,
        material_type: data.item_properties,
        material_uom: data.based_uom,

        bom_type: "STANDARD",
      });

      await db.collection("Item").doc(data.id).update({
        bom_id: resBOM.data[0].id,
        bom_status: resBOM.data[0].bom_status,
      });

      await db
        .collection("bom_tree")
        .doc(resBOM.data[0].id)
        .update({
          root_id: resBOM.data[0].id,
          bom_path: "/" + resBOM.data[0].id + "/",
        });
    }
  }
};

const validateBatch = async (entry) => {
  if (
    entry.item_batch_management === 1 &&
    entry.batch_number_genaration === "According To System Settings"
  ) {
    const resDefaultBatchConfig = await db
      .collection("batch_number_config")
      .where({
        organization_id: entry.organization_id,
      })
      .get();

    if (resDefaultBatchConfig && resDefaultBatchConfig.data.length > 0) {
      if (
        resDefaultBatchConfig.data[0].batch_level_selection === "Item Level"
      ) {
        const itemBatchConfig = await db
          .collection("batch_number_config")
          .where({
            organization_id: entry.organization_id,
            item_id: entry.id,
          })
          .get();

        if (
          (!entry.batch_config ||
            Object.keys(entry.batch_config).length === 0) &&
          (!itemBatchConfig || itemBatchConfig.data.length === 0)
        ) {
          await this.$alert("Please set batch configuration", "Invalid Data", {
            confirmButtonText: "OK",
            type: "error",
          });

          throw new Error("Batch configuration is required");
        }
      }
    }
  }
};

const createBatch = async (itemId, batchNumberConfig, materialCode) => {
  if (!batchNumberConfig || Object.keys(batchNumberConfig).length === 0) {
    return;
  }

  const batchConfig = {
    ...batchNumberConfig,
    batch_format: batchNumberConfig.batch_format.replace(
      /\{itemCode\}/g,
      materialCode || "",
    ),
  };

  await this.runWorkflow(
    "2058838457211068417",
    { allData: { ...batchConfig, item_id: itemId } },
    (res) => {
      console.log("Batch creation result:", res);
    },
    async (err) => {
      this.hideLoading();
      if (err?.data?.code === 401) {
        await this.$alert(err?.data?.msg, "Error saving batch config", {
          confirmButtonText: "Ok",
          type: "error",
          dangerouslyUseHTMLString: true,
        });

        throw new Error(err?.data?.msg);
      }
    },
  );
};

(async () => {
  try {
    this.showLoading();

    const data = this.getValues();

    const page_status = data.page_status;
    const item_no = data.id;

    // Define required fields
    const requiredFields = [
      { name: "item_properties", label: "Item Properties" },
      { name: "material_name", label: "Item Name" },
      ...(data.material_code_type === -9999
        ? [{ name: "material_code", label: "Item Code" }]
        : []),
      { name: "item_category", label: "Item Category" },
      { name: "based_uom", label: "Based UOM" },
    ];

    const missingFields = await validateForm(data, requiredFields);

    await this.validate();

    if (missingFields.length === 0) {
      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      let entry = data;
      entry.material_code =
        entry.material_code_type === -9999 || this.isEdit
          ? entry.material_code
          : "issued";
      entry.batch_number_genaration =
        entry.batch_number_genaration || "According To System Settings";
      entry.posted_status = "Pending Post";

      entry = await validateUOMConversion(entry);
      await validatePackingDetailUOM(entry);
      await validatePurchaseAndSalesInformation(entry);
      await validateBatch(entry);

      console.log("entry", entry);
      let resItem = entry;

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        try {
          resItem = await db.collection("Item").add(entry);
          await createBOM(resItem.data[0]);
          await createBatch(
            resItem.data[0].id,
            entry.batch_config,
            entry.material_code,
          );
        } catch (error) {
          console.error("Error adding item:", error);
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while adding the item.",
          );
        }
      } else if (page_status === "Edit") {
        try {
          // Update the existing item
          if (!item_no) {
            throw new Error("Item ID not found");
          }

          await db.collection("Item").doc(item_no).update(entry);
          await createBOM(entry);
          await createBatch(entry.id, entry.batch_config, entry.material_code);
        } catch (error) {
          console.error("Error updating item:", error);
          this.hideLoading();
          this.$message.error(
            error.message || "An error occurred while updating the item.",
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

          switch (aiData.acc_integration_type) {
            case "SQL Accounting":
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
                          "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
                        );
                      },
                    );
                  }
                },
                (err) => {
                  console.log("失败结果：", err);

                  this.hideLoading();
                  throw new Error(
                    "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
                  );
                },
              );
              break;

            case "AutoCount Accounting":
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
                    "Your AutoCount accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists.",
                  );
                },
              );
              console.log("Calling AutoCount workflow");
              break;

            case "SQL Accounting V2":
            case "AutoCount Accounting V2":
              await this.runWorkflow(
                "2013511169625042946",
                {
                  agent_id: aiData.agent_id,
                  task_type: "post_item",
                  payload: [item_no ?? resItem?.data[0]?.id],
                  priority: "0",
                },
                async (res) => {
                  console.log("成功结果：", res);
                  this.$message.success("Save item successfully.");
                  closeDialog();
                },
                (err) => {
                  console.log("失败结果：", err);
                  this.hideLoading();
                },
              );
              break;

            case "No Accounting Integration":
              await closeDialog();
              console.log("Not calling workflow");
              break;

            default:
              await closeDialog();
              break;
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
