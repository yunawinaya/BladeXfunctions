const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

// Updated to handle array of sales order IDs
const updateSalesOrderStatus = (salesOrderIds, goodsDeliveryNo) => {
  // Ensure salesOrderIds is an array
  const soIds = Array.isArray(salesOrderIds) ? salesOrderIds : [salesOrderIds];

  // Process each sales order
  soIds.forEach((salesOrderId) => {
    if (!salesOrderId) {
      console.warn("Null or undefined sales order ID found");
      return;
    }

    const completedQuery = db
      .collection("sales_invoice")
      .where({ si_status: "Completed", so_id: salesOrderId });

    const fullyPostedQuery = db
      .collection("sales_invoice")
      .where({ si_status: "Fully Posted", so_id: salesOrderId });

    Promise.all([
      completedQuery.get(),
      fullyPostedQuery.get(),
      db.collection("sales_order").where({ id: salesOrderId }).get(),
    ])
      .then(([resComp, resPost, resSO]) => {
        // Handle potentially undefined or empty data
        const compData = resComp?.data || [];
        const postData = resPost?.data || [];
        const allSIs = [...compData, ...postData];

        const soData = resSO?.data ? resSO.data[0] : null;
        if (!soData) {
          console.warn(`Sales order ${salesOrderId} not found`);
          return;
        }

        const soItems = soData.table_so || [];

        // Create a map to sum invoiced quantities for each item
        const invoicedQtyMap = {};

        // Initialize with zeros
        soItems.forEach((item) => {
          if (item && item.item_name) {
            invoicedQtyMap[item.item_name] = 0;
          }
        });

        // Sum invoiced quantities from all SIs
        allSIs.forEach((si) => {
          if (!si || !si.table_si) return;

          si.table_si.forEach((siItem) => {
            if (
              siItem &&
              siItem.material_id &&
              invoicedQtyMap.hasOwnProperty(siItem.material_id)
            ) {
              const invoiceQty = parseFloat(siItem.invoice_qty) || 0;
              invoicedQtyMap[siItem.material_id] += invoiceQty;
            }
          });
        });

        // Check item completion status
        let allItemsComplete = true;
        let anyItemProcessing = false;

        soItems.forEach((item) => {
          if (!item || !item.item_name) return;

          const orderedQty = parseFloat(item.so_quantity) || 0;
          const invoicedQty = parseFloat(invoicedQtyMap[item.item_name]) || 0;

          if (invoicedQty < orderedQty) {
            allItemsComplete = false;
            if (invoicedQty > 0) {
              anyItemProcessing = true;
            }
          }
        });

        // Determine new status
        let newSIStatus = soData.si_status;

        if (allItemsComplete) {
          newSIStatus = "Fully Invoiced";
        } else if (anyItemProcessing) {
          newSIStatus = "Partially Invoiced";
        }

        // Update SO status if changed
        if (newSIStatus !== soData.si_status) {
          console.log(`Updating SO ${salesOrderId} status to ${newSIStatus}`);
          db.collection("sales_order")
            .doc(soData.id)
            .update({
              si_status: newSIStatus,
            })
            .catch((error) => {
              console.error(
                `Error updating sales order ${salesOrderId}:`,
                error
              );
            });
        }
      })
      .catch((error) => {
        console.error(`Error processing sales order ${salesOrderId}:`, error);
      });
  });

  // Update all goods delivery documents
  if (Array.isArray(goodsDeliveryNo) && goodsDeliveryNo.length > 0) {
    goodsDeliveryNo.forEach((gd) => {
      if (!gd) return;

      db.collection("goods_delivery")
        .doc(gd)
        .update({
          si_status: "Fully Invoiced",
        })
        .catch((error) => {
          console.error(`Error updating goods delivery ${gd}:`, error);
        });
    });
  } else {
    console.warn("No goods delivery numbers provided");
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
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return !value;
};

const getPrefixData = async (organizationId) => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Invoices",
        is_deleted: 0,
        organization_id: organizationId,
        is_active: 1,
      })
      .get();

    if (!prefixEntry?.data || prefixEntry.data.length === 0) {
      console.error("No prefix configuration found for Sales Invoices");
      return null;
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error getting prefix data:", error);
    throw error;
  }
};

const updatePrefix = async (organizationId, runningNumber) => {
  try {
    await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Invoices",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .update({ running_number: parseInt(runningNumber) + 1, has_record: 1 });
  } catch (error) {
    console.error("Error updating prefix:", error);
    throw error;
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
  try {
    const existingDoc = await db
      .collection("sales_invoice")
      .where({ sales_invoice_no: generatedPrefix })
      .get();

    return !existingDoc?.data || existingDoc.data.length === 0;
  } catch (error) {
    console.error("Error checking uniqueness:", error);
    throw error;
  }
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
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Sales Invoices number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (!prefixData) {
      throw new Error("Prefix configuration not found");
    }

    await updatePrefix(organizationId, prefixData.running_number);

    const result = await db.collection("sales_invoice").add(entry);

    try {
      await this.runWorkflow(
        "1917950696199892993",
        { sales_invoice_no: entry.sales_invoice_no },
        async (res) => {
          console.log("Workflow success:", res);
        },
        (err) => {
          console.error("Workflow error:", err);
          closeDialog();
        }
      );
    } catch (workflowError) {
      console.error("Error running workflow:", workflowError);
    }

    // Handle multiple SO IDs and GD numbers
    await updateSalesOrderStatus(entry.so_id, entry.goods_delivery_number);

    this.$message.success("Add successfully");
    closeDialog();
  } catch (error) {
    console.error("Error adding entry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, entry, salesInvoiceId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (!prefixData) {
      throw new Error("Prefix configuration not found");
    }

    const { prefixToShow, runningNumber } = await findUniquePrefix(prefixData);

    await updatePrefix(organizationId, runningNumber);

    entry.sales_invoice_no = prefixToShow;

    await db.collection("sales_invoice").doc(salesInvoiceId).update(entry);

    try {
      await this.runWorkflow(
        "1917950696199892993",
        { sales_invoice_no: entry.sales_invoice_no },
        async (res) => {
          console.log("Workflow success:", res);
        },
        (err) => {
          console.error("Workflow error:", err);
          closeDialog();
        }
      );
    } catch (workflowError) {
      console.error("Error running workflow:", workflowError);
    }

    // Handle multiple SO IDs and GD numbers
    await updateSalesOrderStatus(entry.so_id, entry.goods_delivery_number);

    this.$message.success("Update successfully");
    closeDialog();
  } catch (error) {
    console.error("Error updating entry:", error);
    throw error;
  }
};

// Main execution
(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

    const requiredFields = [
      { name: "so_id", label: "SO Number" },
      { name: "goods_delivery_number", label: "Goods Delivery Number" },
      { name: "sales_invoice_no", label: "Sales Invoice Number " },
      { name: "sales_invoice_date", label: "Sales Invoice Date" },
      { name: "si_description", label: "Description" },
      {
        name: "table_si",
        label: "SI Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    const missingFields = validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        fake_so_id,
        so_id,
        customer_id,
        si_address_name,
        si_address_contact,
        goods_delivery_number,
        sales_invoice_no,
        sales_invoice_date,
        sales_person_id,
        si_payment_term_id,
        si_description,
        plant_id,
        organization_id,
        fileupload_hmtcurne,
        so_no_display,
        table_si,
        invoice_subtotal,
        invoice_total_discount,
        invoice_taxes_amount,
        invoice_total,
        remarks,
        si_shipping_address,
        si_billing_address,
        gd_no_display,
        currency_code,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_postal_code,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_postal_code,
        shipping_address_country,
        exchange_rate,
        myr_total_amount,
      } = data;

      // Ensure SO IDs and GD numbers are properly handled as arrays
      const soIdArray = Array.isArray(so_id) ? so_id : [so_id];
      const gdArray = Array.isArray(goods_delivery_number)
        ? goods_delivery_number
        : [goods_delivery_number];

      const entry = {
        si_status: "Completed",
        posted_status: "Unposted",
        fake_so_id,
        so_id: soIdArray,
        customer_id,
        si_address_name,
        si_address_contact,
        goods_delivery_number: gdArray,
        sales_invoice_no,
        sales_invoice_date,
        sales_person_id,
        si_payment_term_id,
        si_description,
        plant_id,
        organization_id,
        so_no_display,
        fileupload_hmtcurne,
        table_si,
        invoice_subtotal,
        invoice_total_discount,
        invoice_taxes_amount,
        invoice_total,
        remarks,
        si_shipping_address,
        si_billing_address,
        gd_no_display,
        currency_code,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_postal_code,
        billing_address_country,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_postal_code,
        shipping_address_country,
        exchange_rate,
        myr_total_amount,
      };

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        const salesInvoiceId = this.getValue("id");
        await updateEntry(organizationId, entry, salesInvoiceId);
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    this.hideLoading();
    this.$message.error(error.message || error);
  }
})();
