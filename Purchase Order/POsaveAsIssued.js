const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const addOnPO = async (data) => {
  // Log function entry with input data
  console.log(
    `[${new Date().toISOString()}] addOnPO started with data:`,
    JSON.stringify(data, null, 2)
  );
  const currentPOStatus = this.getValue("po_status");
  console.log(
    `[${new Date().toISOString()}] Current PO Status: ${currentPOStatus}`
  );

  const items = data.table_po;

  // Validate items array
  if (!Array.isArray(items)) {
    console.error(
      `[${new Date().toISOString()}] table_po is not an array:`,
      items
    );
    return;
  }
  console.log(`[${new Date().toISOString()}] Processing ${items.length} items`);

  const processPromises = items.map(async (item, index) => {
    try {
      // Log item details
      console.log(
        `[${new Date().toISOString()}] Processing item ${index + 1}:`,
        {
          item_id: item.item_id,
          quantity: item.quantity,
          quantity_uom: item.quantity_uom,
        }
      );

      // Query Item collection
      console.log(
        `[${new Date().toISOString()}] Querying Item collection for item_id: ${
          item.item_id
        }`
      );
      const itemRes = await db
        .collection("Item")
        .where({ id: item.item_id })
        .get();

      // Check query result
      if (!itemRes.data || !itemRes.data.length) {
        console.error(
          `[${new Date().toISOString()}] Item not found for item_id: ${
            item.item_id
          }`
        );
        return;
      }
      console.log(`[${new Date().toISOString()}] Item found:`, itemRes.data[0]);

      const itemData = itemRes.data[0];

      // Initialize quantities and UOMs
      let altQty = parseFloat(item.quantity);
      let baseQty = altQty;
      let altUOM = item.quantity_uom;
      let baseUOM = itemData.based_uom;
      console.log(
        `[${new Date().toISOString()}] Initial quantities - altQty: ${altQty} ${altUOM}, baseQty: ${baseQty} ${baseUOM}`
      );

      // Handle UOM conversion
      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        console.log(
          `[${new Date().toISOString()}] Checking UOM conversions for item ${
            item.item_id
          }`
        );

        const uomConversion = itemData.table_uom_conversion.find(
          (conv) => conv.alt_uom_id === altUOM
        );

        if (uomConversion) {
          console.log(
            `[${new Date().toISOString()}] Found UOM conversion: 1 ${
              uomConversion.alt_uom_id
            } = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
          );

          baseQty = Math.round(altQty * uomConversion.base_qty * 1000) / 1000;
          console.log(
            `[${new Date().toISOString()}] Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`
          );
        } else {
          console.warn(
            `[${new Date().toISOString()}] No conversion found for UOM ${altUOM}, using as-is`
          );
        }
      } else {
        console.warn(
          `[${new Date().toISOString()}] No UOM conversion table for item ${
            item.item_id
          }, using ordered quantity as-is`
        );
      }

      // Prepare onOrderData
      const onOrderData = {
        purchase_order_number: data.purchase_order_no,
        material_id: item.item_id,
        purchase_order_line: index + 1,
        scheduled_qty: baseQty,
        open_qty: baseQty,
        received_qty: 0,
        plant_id: data.po_plant,
        organization_id: data.organization_id,
      };
      console.log(
        `[${new Date().toISOString()}] Prepared onOrderData for item ${
          index + 1
        }:`,
        onOrderData
      );

      // Handle PO status
      if (currentPOStatus && currentPOStatus === "Issued") {
        console.log(
          `[${new Date().toISOString()}] Updating on_order_purchase_order for item ${
            index + 1
          } (PO Status: Issued)`
        );
        await db
          .collection("on_order_purchase_order")
          .where({
            plant_id: onOrderData.plant_id,
            organization_id: onOrderData.organization_id,
            purchase_order_number: onOrderData.purchase_order_number,
            material_id: onOrderData.material_id,
            purchase_order_line: onOrderData.purchase_order_line,
          })
          .update(onOrderData)
          .catch((error) => {
            console.error(
              `[${new Date().toISOString()}] Error updating on_order_purchase_order for item ${
                index + 1
              }:`,
              error
            );
            throw error; // Rethrow to be caught by outer try-catch
          });
        console.log(
          `[${new Date().toISOString()}] Successfully updated on_order_purchase_order for item ${
            index + 1
          }`
        );
      } else if (!currentPOStatus || currentPOStatus === "Draft") {
        console.log(
          `[${new Date().toISOString()}] Adding to on_order_purchase_order for item ${
            index + 1
          } (PO Status: ${currentPOStatus || "None"})`
        );
        await db
          .collection("on_order_purchase_order")
          .add(onOrderData)
          .catch((error) => {
            console.error(
              `[${new Date().toISOString()}] Error adding to on_order_purchase_order for item ${
                index + 1
              }:`,
              error
            );
            throw error; // Rethrow to be caught by outer try-catch
          });
        console.log(
          `[${new Date().toISOString()}] Successfully added to on_order_purchase_order for item ${
            index + 1
          }`
        );
      } else {
        console.warn(
          `[${new Date().toISOString()}] Unexpected PO status: ${currentPOStatus}, skipping update/add for item ${
            index + 1
          }`
        );
      }
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error processing item ${
          item.item_id
        } (index ${index + 1}):`,
        error
      );
    }
  });

  // Wait for all items to be processed
  console.log(
    `[${new Date().toISOString()}] Waiting for all items to be processed`
  );
  await Promise.all(processPromises);
  console.log(`[${new Date().toISOString()}] All items processed successfully`);
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
      document_types: "Purchase Orders",
      is_deleted: 0,
      organization_id: organizationId,
      is_active: 1,
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
        document_types: "Purchase Orders",
        is_deleted: 0,
        organization_id: organizationId,
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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("purchase_order")
    .where({
      purchase_order_no: generatedPrefix,
      organization_id: organizationId,
    })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Purchase Order number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const checkExistingGoodsReceiving = async () => {
  const poID = this.getValue("id");

  const resGR = await db
    .collection("goods_receiving")
    .filter([
      {
        prop: "purchase_order_id",
        operator: "in",
        value: poID,
      },
    ])
    .get();

  if (!resGR || resGR.data.length === 0) return [];

  console.log("checkExistingGR", resGR.data);
  return resGR.data;
};

const checkExistingPurchaseInvoice = async () => {
  const poID = this.getValue("id");

  const resPI = await db
    .collection("purchase_invoice")
    .filter([
      {
        prop: "purchase_order_id",
        operator: "in",
        value: poID,
      },
    ])
    .get();

  if (!resPI || resPI.data.length === 0) return [];

  return resPI.data;
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.purchase_order_no = prefixToShow;
    }

    await db.collection("purchase_order").add(entry);
    await addOnPO(entry);

    this.runWorkflow(
      "1917415599201660930",
      { purchase_order_no: entry.purchase_order_no },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
        throw new Error("An error occurred.");
      }
    );
    this.$message.success("Add successfully");
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, purchaseOrderId) => {
  try {
    const currentPOStatus = await this.getValue("po_status");

    if (!currentPOStatus || currentPOStatus !== "Issued") {
      const prefixData = await getPrefixData(organizationId);

      if (prefixData !== null) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId
        );

        await updatePrefix(organizationId, runningNumber);

        entry.purchase_order_no = prefixToShow;
      }
    }

    await db.collection("purchase_order").doc(purchaseOrderId).update(entry);
    await addOnPO(entry);

    this.runWorkflow(
      "1917415599201660930",
      { purchase_order_no: entry.purchase_order_no },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
        throw new Error("An error occurred.");
      }
    );

    this.$message.success("Update successfully");
  } catch (error) {
    this.hideLoading();
    this.$message.error(error);
  }
};

const validateQuantity = async (tablePO) => {
  const quantityFailValFields = [];
  const itemFailValFields = [];

  tablePO.forEach((item, index) => {
    if (item.item_id || item.item_desc) {
      if (item.quantity <= 0) {
        quantityFailValFields.push(`${item.item_name || item.item_desc}`);
      }
    } else {
      if (item.quantity > 0) {
        itemFailValFields.push(index + 1);
      }
    }
  });

  return { quantityFailValFields, itemFailValFields };
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
    }
    return entry.table_po;
  } catch (error) {
    throw new Error("Error processing purchase order.");
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    const requiredFields = [
      { name: "po_supplier_id", label: "Supplier Name" },
      { name: "po_plant", label: "Plant" },
      {
        name: "table_po",
        label: "Item Information",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);
    const { quantityFailValFields, itemFailValFields } = await validateQuantity(
      data.table_po
    );
    await this.validate("purchase_order_no");

    if (
      missingFields.length === 0 &&
      quantityFailValFields.length === 0 &&
      itemFailValFields.length === 0
    ) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        po_supplier_id,
        po_date,
        organization_id,
        po_currency,
        po_delivery_address,
        purchase_order_no,
        po_plant,
        partially_received,
        fully_received,
        po_receiving_supplier,
        po_billing_address,
        po_shipping_address,
        po_payment_terms,
        po_expected_date,
        po_shipping_preference,
        po_ref_doc,
        table_po,
        po_total_gross,
        po_total_discount,
        po_total_tax,
        po_total,
        po_remark,
        po_tnc,
        preq_no,
        preq_id,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_postal_code,
        billing_address_state,
        billing_address_country,
        billing_address_name,
        billing_address_phone,
        billing_attention,

        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_postal_code,
        shipping_address_state,
        shipping_address_country,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,

        exchange_rate,
        myr_total_amount,
      } = data;

      const entry = {
        po_status: "Issued",
        purchase_order_no,
        po_supplier_id,
        po_date,
        organization_id,
        po_currency,
        po_delivery_address,
        po_plant,
        partially_received,
        fully_received,
        po_receiving_supplier,
        po_billing_address,
        po_shipping_address,
        po_payment_terms,
        po_expected_date,
        po_shipping_preference,
        po_ref_doc,
        table_po,
        po_total_gross,
        po_total_discount,
        po_total_tax,
        po_total,
        po_remark,
        po_tnc,
        preq_no,
        preq_id,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_postal_code,
        billing_address_state,
        billing_address_country,
        billing_address_name,
        billing_address_phone,
        billing_attention,

        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_postal_code,
        shipping_address_state,
        shipping_address_country,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,

        exchange_rate,
        myr_total_amount,
      };

      if (
        (!partially_received || partially_received === "") &&
        (!fully_received || fully_received === "")
      ) {
        const lineItemLength = entry.table_po.length;

        entry.partially_received = `0 / ${lineItemLength}`;
        entry.fully_received = `0 / ${lineItemLength}`;
      }

      const latestPO = entry.table_po.filter(
        (item) => (item.item_id || item.item_desc) && item.quantity > 0
      );
      entry.table_po = latestPO;

      if (entry.table_po.length === 0) {
        throw new Error(
          "Item Information must not be empty. Please add at least one valid item with quantity > 0"
        );
      }

      entry.table_po = await fillbackHeaderFields(entry);

      if (page_status === "Add" || page_status === "Clone") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        const purchaseOrderId = this.getValue("id");
        const currentPOStatus = this.getValue("po_status");

        if (currentPOStatus === "Issued") {
          const existingGR = await checkExistingGoodsReceiving();
          const existingPI = await checkExistingPurchaseInvoice();

          if (existingGR.length > 0 || existingPI.length > 0) {
            this.hideLoading();
            this.openDialog("auto_delete_dialog");

            if (existingGR.length > 0 && existingPI.length === 0) {
              this.display("auto_delete_dialog.text_gr");
              this.hide("auto_delete_dialog.text_pi");
            } else if (existingGR.length === 0 && existingPI.length > 0) {
              this.display("auto_delete_dialog.text_pi");
              this.hide("auto_delete_dialog.text_gr");
            } else {
              this.display([
                "auto_delete_dialog.text_pi",
                "auto_delete_dialog.text_gr",
              ]);
            }

            return;
          }
        }
        await updateEntry(organizationId, entry, purchaseOrderId);
      }

      await updateItemTransactionDate(entry);
      await closeDialog();
    } else if (missingFields.length > 0) {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    } else if (
      quantityFailValFields.length > 0 ||
      itemFailValFields.length > 0
    ) {
      this.hideLoading();
      await this.openDialog("confirm_dialog");
      this.setData({
        [`confirm_dialog.quantity_message`]: "",
        [`confirm_dialog.item_missing_message`]: "",
      });
      if (quantityFailValFields.length > 0) {
        await this.display(`confirm_dialog.quantity_message`);
        this.setData({
          [`confirm_dialog.quantity_message`]: `The following items have quantity less than or equal to zero: ${quantityFailValFields.join(
            `, `
          )}`,
        });
      } else {
        await this.hide(`confirm_dialog.quantity_message`);
      }

      if (itemFailValFields.length > 0) {
        await this.display(`confirm_dialog.item_missing_message`);
        this.setData({
          [`confirm_dialog.item_missing_message`]: `The following items have quantity but missing item code / item description: Line ${itemFailValFields.join(
            `, Line `
          )}`,
        });
      } else {
        await this.hide(`confirm_dialog.item_missing_message`);
      }
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
