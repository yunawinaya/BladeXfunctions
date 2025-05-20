const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const addOnPO = async (data) => {
  const items = data.table_po;

  if (!Array.isArray(items)) {
    console.log("table_po is not an array:", items);
    return;
  }

  const processPromises = items.map(async (item, index) => {
    try {
      const itemRes = await db
        .collection("Item")
        .where({ id: item.item_id })
        .get();

      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_id}`);
        return;
      }

      const itemData = itemRes.data[0];

      let altQty = parseFloat(item.quantity);
      let baseQty = altQty;
      let altUOM = item.quantity_uom;
      let baseUOM = itemData.based_uom;

      if (
        Array.isArray(itemData.table_uom_conversion) &&
        itemData.table_uom_conversion.length > 0
      ) {
        console.log(`Checking UOM conversions for item ${item.item_id}`);

        const uomConversion = itemData.table_uom_conversion.find(
          (conv) => conv.alt_uom_id === altUOM
        );

        if (uomConversion) {
          console.log(
            `Found UOM conversion: 1 ${uomConversion.alt_uom_id} = ${uomConversion.base_qty} ${uomConversion.base_uom_id}`
          );

          baseQty = Math.round(altQty * uomConversion.base_qty * 1000) / 1000;

          console.log(`Converted ${altQty} ${altUOM} to ${baseQty} ${baseUOM}`);
        } else {
          console.log(`No conversion found for UOM ${altUOM}, using as-is`);
        }
      } else {
        console.log(
          `No UOM conversion table for item ${item.item_id}, using ordered quantity as-is`
        );
      }

      const onOrderData = {
        purchase_order_number: data.purchase_order_no,
        material_id: item.item_id,
        material_name: item.item_id,
        purchase_order_line: index + 1,
        scheduled_qty: baseQty,
        open_qty: baseQty,
        received_qty: 0,
      };

      await db
        .collection("on_order_purchase_order")
        .add(onOrderData)
        .catch((error) => {
          console.log(
            `Error adding on_order_purchase_order for item ${index + 1}:`,
            error
          );
        });
    } catch (error) {
      console.error(`Error processing item ${item.item_id}:`, error);
    }
  });

  // Wait for all items to be processed
  await Promise.all(processPromises);
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
    if (field.arrayType === "object" && field.arrayFields) {
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

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("purchase_order")
    .where({ purchase_order_no: generatedPrefix })
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
      "Could not generate a unique Purchase Orders number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);
    if (prefixData.length !== 0) {
      await updatePrefix(organizationId, prefixData.running_number);
      await db.collection("purchase_order").add(entry);
      this.runWorkflow(
        "1917415599201660930",
        { purchase_order_no: entry.purchase_order_no },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          console.error("失败结果：", err);
          closeDialog();
        }
      );
      await addOnPO(entry);
      this.$message.success("Add successfully");
      closeDialog();
    }
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (organizationId, entry, purchaseOrderId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData
      );

      await updatePrefix(organizationId, runningNumber);

      entry.purchase_order_no = prefixToShow;
      await db.collection("purchase_order").doc(purchaseOrderId).update(entry);
      this.runWorkflow(
        "1917415599201660930",
        { purchase_order_no: entry.purchase_order_no },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          console.error("失败结果：", err);
          closeDialog();
        }
      );
      await addOnPO(entry);
      this.$message.success("Update successfully");
      await closeDialog();
    }
  } catch (error) {
    this.$message.error(error);
  }
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    console.log("data", data);
    const requiredFields = [
      { name: "purchase_order_no", label: "PO Number" },
      { name: "po_supplier_id", label: "Supplier Name" },
      { name: "po_plant", label: "Plant" },
      {
        name: "table_po",
        label: "PO Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [
          { name: "item_id", label: "Item Name" },
          { name: "quantity", label: "Quantity" },
          { name: "unit_price", label: "Unit Price" },
        ],
      },
    ];

    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
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
        po_billing_name,
        po_billing_cp,
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
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_postal_code,
        billing_address_state,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_postal_code,
        shipping_address_state,
        shipping_address_country,
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
        po_billing_name,
        po_billing_cp,
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
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_postal_code,
        billing_address_state,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_postal_code,
        shipping_address_state,
        shipping_address_country,
        exchange_rate,
        myr_total_amount,
      };

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
        closeDialog();
      } else if (page_status === "Edit") {
        const purchaseOrderId = this.getValue("id");
        await updateEntry(organizationId, entry, purchaseOrderId);
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
