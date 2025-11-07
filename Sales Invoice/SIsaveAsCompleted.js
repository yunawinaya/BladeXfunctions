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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("sales_invoice")
    .where({
      sales_invoice_no: generatedPrefix,
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
      "Could not generate a unique Sales Invoices number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

// Check credit & overdue limit before doing any process
const checkCreditOverdueLimit = async (customer_id, invoice_total) => {
  try {
    const fetchCustomer = await db
      .collection("Customer")
      .where({ id: customer_id, is_deleted: 0 })
      .get();

    const customerData = fetchCustomer.data[0];
    if (!customerData) {
      console.error(`Customer ${customer_id} not found`);
      this.$message.error(`Customer ${customer_id} not found`);
      return false;
    }

    const controlTypes = customerData.control_type_list;

    const outstandingAmount =
      parseFloat(customerData.outstanding_balance || 0) || 0;
    const overdueAmount =
      parseFloat(customerData.overdue_inv_total_amount || 0) || 0;
    const overdueLimit = parseFloat(customerData.overdue_limit || 0) || 0;
    const creditLimit =
      parseFloat(customerData.customer_credit_limit || 0) || 0;
    const gdTotal = parseFloat(invoice_total || 0) || 0;
    const revisedOutstandingAmount = outstandingAmount + gdTotal;

    // Helper function to show specific pop-ups as per specification
    const showPopup = (popupNumber) => {
      this.openDialog("dialog_credit_limit");

      this.hide([
        "dialog_credit_limit.alert_credit_limit",
        "dialog_credit_limit.alert_overdue_limit",
        "dialog_credit_limit.alert_credit_overdue",
        "dialog_credit_limit.alert_suspended",
        "dialog_credit_limit.text_credit_limit",
        "dialog_credit_limit.text_overdue_limit",
        "dialog_credit_limit.text_credit_overdue",
        "dialog_credit_limit.text_suspended",
        "dialog_credit_limit.total_allowed_credit",
        "dialog_credit_limit.total_credit",
        "dialog_credit_limit.total_allowed_overdue",
        "dialog_credit_limit.total_overdue",
        "dialog_credit_limit.text_1",
        "dialog_credit_limit.text_2",
        "dialog_credit_limit.text_3",
        "dialog_credit_limit.text_4",
        "dialog_credit_limit.button_back",
        "dialog_credit_limit.button_no",
        "dialog_credit_limit.button_yes",
      ]);

      const popupConfigs = {
        1: {
          // Pop-up 1: Exceed Credit Limit Only (Block)
          alert: "alert_credit_limit", // "Alert: Credit Limit Exceeded - Review Required"
          text: "text_credit_limit", // "The customer has exceed the allowed credit limit."
          showCredit: true,
          showOverdue: false,
          isBlock: true,
          buttonText: "text_1", // "Please review the credit limit or adjust the order amount before issuing the SO."
        },
        2: {
          // Pop-up 2: Exceed Overdue Limit Only (Block)
          alert: "alert_overdue_limit", // "Alert: Overdue Limit Exceeded - Review Required"
          text: "text_overdue_limit", // "The customer has exceeded the allowed overdue limit."
          showCredit: false,
          showOverdue: true,
          isBlock: true,
          buttonText: "text_2", // "Please review overdue invoices before proceeding."
        },
        3: {
          // Pop-up 3: Exceed Both, Credit Limit and Overdue Limit (Block)
          alert: "alert_credit_overdue", // "Alert: Credit Limit and Overdue Limit Exceeded - Review Required"
          text: "text_credit_overdue", // "The customer has exceeded both credit limit and overdue limit."
          showCredit: true,
          showOverdue: true,
          isBlock: true,
          buttonText: "text_3", // "Please review both limits before proceeding."
        },
        4: {
          // Pop-up 4: Exceed Overdue Limit Only (Override)
          alert: "alert_overdue_limit", // "Alert: Overdue Limit Exceeded - Review Required"
          text: "text_overdue_limit", // "The customer has exceeded the allowed overdue limit."
          showCredit: false,
          showOverdue: true,
          isBlock: false,
          buttonText: "text_4", // "Please confirm if you wants to save it."
        },
        5: {
          // Pop-up 5: Exceed Credit Limit Only (Override)
          alert: "alert_credit_limit", // "Alert: Credit Limit Exceeded - Review Required"
          text: "text_credit_limit", // "The customer has exceed the allowed credit limit."
          showCredit: true,
          showOverdue: false,
          isBlock: false,
          buttonText: "text_4", // "Please confirm if you wants to save it."
        },
        6: {
          // Pop-up 6: Suspended
          alert: "alert_suspended", // "Customer Account Suspended"
          text: "text_suspended", // "This order cannot be processed at this time due to the customer's suspended account status."
          showCredit: false,
          showOverdue: false,
          isBlock: true,
          buttonText: null, // No additional text needed
        },
        7: {
          // Pop-up 7: Exceed Both, Credit Limit and Overdue Limit (Override)
          alert: "alert_credit_overdue", // "Alert: Credit Limit and Overdue Limit Exceeded - Review Required"
          text: "text_credit_overdue", // "The customer has exceeded both credit limit and overdue limit."
          showCredit: true,
          showOverdue: true,
          isBlock: false,
          buttonText: "text_4", // "Please confirm if you wants to save it."
        },
      };

      const config = popupConfigs[popupNumber];
      if (!config) return false;

      // Show alert message
      this.display(`dialog_credit_limit.${config.alert}`);

      // Show description text
      this.display(`dialog_credit_limit.${config.text}`);

      const dataToSet = {};

      // Show credit limit details if applicable
      if (config.showCredit) {
        this.display("dialog_credit_limit.total_allowed_credit");
        this.display("dialog_credit_limit.total_credit");
        dataToSet["dialog_credit_limit.total_allowed_credit"] = creditLimit;
        dataToSet["dialog_credit_limit.total_credit"] =
          revisedOutstandingAmount;
      }

      // Show overdue limit details if applicable
      if (config.showOverdue) {
        this.display("dialog_credit_limit.total_allowed_overdue");
        this.display("dialog_credit_limit.total_overdue");
        dataToSet["dialog_credit_limit.total_allowed_overdue"] = overdueLimit;
        dataToSet["dialog_credit_limit.total_overdue"] = overdueAmount;
      }

      // Show action text if applicable
      if (config.buttonText) {
        this.display(`dialog_credit_limit.${config.buttonText}`);
      }

      // Show appropriate buttons
      if (config.isBlock) {
        this.display("dialog_credit_limit.button_back"); // "Back" button
      } else {
        this.display("dialog_credit_limit.button_yes"); // "Yes" button
        this.display("dialog_credit_limit.button_no"); // "No" button
      }

      this.setData(dataToSet);
      return false;
    };

    // Check if accuracy flag is set
    if (controlTypes && Array.isArray(controlTypes)) {
      // Define control type behaviors according to specification
      const controlTypeChecks = {
        // Control Type 0: Ignore both checks (always pass)
        0: () => {
          console.log("Control Type 0: Ignoring all credit/overdue checks");
          return { result: true, priority: "unblock" };
        },

        // Control Type 1: Ignore credit, block overdue
        1: () => {
          if (overdueAmount > overdueLimit) {
            return { result: showPopup(2), priority: "block" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 2: Ignore credit, override overdue
        2: () => {
          if (overdueAmount > overdueLimit) {
            return { result: showPopup(4), priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 3: Block credit, ignore overdue
        3: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return { result: showPopup(1), priority: "block" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 4: Block both
        4: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;

          if (creditExceeded && overdueExceeded) {
            return { result: showPopup(3), priority: "block" };
          } else if (creditExceeded) {
            return { result: showPopup(1), priority: "block" };
          } else if (overdueExceeded) {
            return { result: showPopup(2), priority: "block" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 5: Block credit, override overdue
        5: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;

          // Credit limit block takes priority
          if (creditExceeded) {
            if (overdueExceeded) {
              return { result: showPopup(3), priority: "block" };
            } else {
              return { result: showPopup(1), priority: "block" };
            }
          } else if (overdueExceeded) {
            return { result: showPopup(4), priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 6: Override credit, ignore overdue
        6: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return { result: showPopup(5), priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 7: Override credit, block overdue
        7: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;

          // Overdue block takes priority over credit override
          if (overdueExceeded) {
            return { result: showPopup(2), priority: "block" };
          } else if (creditExceeded) {
            return { result: showPopup(5), priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 8: Override both
        8: () => {
          const creditExceeded = revisedOutstandingAmount > creditLimit;
          const overdueExceeded = overdueAmount > overdueLimit;

          if (creditExceeded && overdueExceeded) {
            return { result: showPopup(7), priority: "override" };
          } else if (creditExceeded) {
            return { result: showPopup(5), priority: "override" };
          } else if (overdueExceeded) {
            return { result: showPopup(4), priority: "override" };
          }
          return { result: true, priority: "unblock" };
        },

        // Control Type 9: Suspended customer
        9: () => {
          return { result: showPopup(6), priority: "block" };
        },
      };

      // Process according to specification:
      // "Ignore parameter with unblock > check for parameter with block's first > if not block only proceed to check for override"

      // First, collect all applicable control types for Sales Invoices
      const applicableControls = controlTypes
        .filter((ct) => ct.document_type === "Sales Invoices")
        .map((ct) => {
          const checkResult = controlTypeChecks[ct.control_type]
            ? controlTypeChecks[ct.control_type]()
            : { result: true, priority: "unblock" };
          return {
            ...checkResult,
            control_type: ct.control_type,
          };
        });

      // Sort by priority: blocks first, then overrides, then unblocks
      const priorityOrder = { block: 1, override: 2, unblock: 3 };
      applicableControls.sort(
        (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
      );

      // Process in priority order
      for (const control of applicableControls) {
        if (control.result !== true) {
          console.log(
            `Control Type ${control.control_type} triggered with ${control.priority}`
          );
          return control.result;
        }
      }

      // All checks passed
      return true;
    } else {
      console.log(
        "No control type defined for customer or invalid control type format"
      );
      return true;
    }
  } catch (error) {
    console.error("Error checking credit/overdue limits:", error);
    this.$alert(
      "An error occurred while checking credit limits. Please try again.",
      "Error",
      {
        confirmButtonText: "OK",
        type: "error",
      }
    );
    return false;
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
    return obj.toString();
  }
  return null;
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

      entry.sales_invoice_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        entry.sales_invoice_no,
        organizationId
      );
      if (!isUnique) {
        throw new Error(
          `SI Number "${entry.sales_invoice_no}" already exists. Please use a different number.`
        );
      }
    }

    await db.collection("sales_invoice").add(entry);
    // Handle multiple SO IDs and GD numbers
    await updateReferenceDocStatus(entry);

    this.$message.success("Add successfully");
    closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error("Error adding entry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, entry, salesInvoiceId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.sales_invoice_no = prefixToShow;
    } else {
      const isUnique = await checkUniqueness(
        entry.sales_invoice_no,
        organizationId
      );
      if (!isUnique) {
        throw new Error(
          `SI Number "${entry.sales_invoice_no}" already exists. Please use a different number.`
        );
      }
    }

    await db.collection("sales_invoice").doc(salesInvoiceId).update(entry);
    // Handle multiple SO IDs and GD numbers
    await updateReferenceDocStatus(entry);

    this.$message.success("Update successfully");
    closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error("Error updating entry:", error);
    throw error;
  }
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, siLineItem] of entry.table_si.entries()) {
      siLineItem.customer_id = entry.customer_id || null;
      siLineItem.plant_id = entry.plant_id || null;
      siLineItem.payment_term_id = entry.si_payment_term_id || null;
      siLineItem.billing_state_id = entry.billing_address_state || null;
      siLineItem.billing_country_id = entry.billing_address_country || null;
      siLineItem.shipping_state_id = entry.shipping_address_state || null;
      siLineItem.shipping_country_id = entry.shipping_address_country || null;
      siLineItem.line_index = index + 1;
      siLineItem.agent_id = entry.sales_person_id;
    }
    return entry.table_si;
  } catch (error) {
    throw new Error("Error processing sales invoice.");
  }
};

const processSILineItem = async (entry) => {
  const totalQuantity = entry.table_si.reduce((sum, item) => {
    const { invoice_qty } = item;
    return sum + (invoice_qty || 0); // Handle null/undefined received_qty
  }, 0);

  if (totalQuantity === 0) {
    throw new Error("Total invoiced quantity is 0.");
  }

  const zeroQtyArray = [];
  for (const [index, si] of entry.table_si.entries()) {
    if (si.invoice_qty <= 0) {
      zeroQtyArray.push(`#${index + 1}`);
    }
  }

  if (zeroQtyArray.length > 0) {
    await this.$confirm(
      `Line${zeroQtyArray.length > 1 ? "s" : ""} ${zeroQtyArray.join(", ")} ha${
        zeroQtyArray.length > 1 ? "ve" : "s"
      } a zero invoice quantity, which may prevent processing.\nIf you proceed, it will delete the row with 0 invoice quantity. \nWould you like to proceed?`,
      "Zero Invoice Quantity Detected",
      {
        confirmButtonText: "OK",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: false,
      }
    )
      .then(async () => {
        console.log("User clicked OK");
        entry.table_si = entry.table_si.filter((item) => item.invoice_qty > 0);
        let soID = [];
        let gdID = [];
        let salesOrderNumber = [];
        let goodsDeliveryNumber = [];
        for (const si of entry.table_si) {
          if (si.line_gd_id && si.line_gd_id !== "") {
            gdID.push(si.line_gd_id);
            goodsDeliveryNumber.push(si.line_gd_no);
          }

          soID.push(si.line_so_id);
          salesOrderNumber.push(si.line_so_no);
        }

        soID = [...new Set(soID)];
        gdID = [...new Set(gdID)];
        salesOrderNumber = [...new Set(salesOrderNumber)];
        goodsDeliveryNumber = [...new Set(goodsDeliveryNumber)];

        entry.so_id = soID;
        entry.gd_id = gdID;
        entry.so_no_display = salesOrderNumber.join(", ");
        entry.gd_no_display = goodsDeliveryNumber.join(", ");

        return entry;
      })
      .catch(() => {
        // Function to execute when the user clicks "Cancel" or closes the dialog
        console.log("User clicked Cancel or closed the dialog");
        this.hideLoading();
        throw new Error("Saving sales invoice cancelled.");
        // Add your logic to stop or handle cancellation here
        // Example: this.stopFunction();
      });
  }

  return entry;
};

const updateReferenceDocStatus = async (data) => {
  // Validate input data
  if (!data || !data.so_id || !data.table_si) {
    throw new Error("Invalid input data: so_id and table_si are required");
  }

  const soIds = Array.isArray(data.so_id) ? data.so_id : [data.so_id];

  // Process Goods Receiving (GR) documents if doc_type is "Goods Receiving"
  if (data.gd_id.length > 0) {
    const gdIds = Array.isArray(data.gd_id) ? data.gd_id : [data.gd_id];
    await updateGoodsDelivery(gdIds, data.table_si);
  }

  // Process Purchase Order (PO) documents
  await updateSalesOrder(soIds, data.table_si);
};

const updateGoodsDelivery = async (gdIds, tableSi) => {
  const updateGDPromises = gdIds.map(async (goodsDeliveryId) => {
    try {
      // Fetch GR document
      const resGD = await db
        .collection("goods_delivery")
        .where({ id: goodsDeliveryId })
        .field("table_gd,si_status")
        .get();

      if (!resGD || !resGD.data || resGD.data.length === 0) {
        console.warn(
          `No Goods Delivery document found for ID: ${goodsDeliveryId}`
        );
        return;
      }

      const gdDoc = resGD.data[0];
      const gdItems = gdDoc.table_gd || [];

      // Process GR items
      const { updatedItems, newSIStatus } = processItems(
        gdItems,
        tableSi,
        gdDoc.id,
        "line_gd_id",
        "gd_line_id",
        "gd_qty"
      );

      // Update GR document
      await db.collection("goods_delivery").doc(gdDoc.id).update({
        table_gd: updatedItems,
        si_status: newSIStatus,
      });
    } catch (error) {
      console.error(
        `Error updating Goods Delivery ID ${goodsDeliveryId}:`,
        error
      );
      throw error;
    }
  });

  await Promise.all(updateGDPromises);
};

const updateSalesOrder = async (soIds, tableSi) => {
  const updateSOPromises = soIds.map(async (salesOrderId) => {
    try {
      // Fetch PO document
      const resSO = await db
        .collection("sales_order")
        .where({ id: salesOrderId })
        .field("table_so,si_status")
        .get();

      if (!resSO || !resSO.data || resSO.data.length === 0) {
        console.warn(`No Sales Order document found for ID: ${salesOrderId}`);
        return;
      }

      const soDoc = resSO.data[0];
      const soItems = soDoc.table_so || [];

      // Process PO items
      const { updatedItems, newSIStatus } = processItems(
        soItems,
        tableSi,
        soDoc.id,
        "line_so_id",
        "so_line_id",
        "so_quantity"
      );

      // Update PO document
      await db.collection("sales_order").doc(soDoc.id).update({
        table_so: updatedItems,
        si_status: newSIStatus,
      });
    } catch (error) {
      console.error(`Error updating Sales Order ID ${salesOrderId}:`, error);
      throw error;
    }
  });

  await Promise.all(updateSOPromises);
};

const processItems = (items, tableSi, docId, docIdKey, siLineIdKey, qtyKey) => {
  // Filter PI items for the current document
  const filteredSI = tableSi.filter((item) => item[docIdKey] === docId);

  // Filter items where item.id matches any siLineIdKey in filteredSI
  const filteredItems = items.filter((item) =>
    filteredSI.some((pi) => pi[siLineIdKey] === item.id)
  );

  // Initialize tracking
  let totalItems = items.length;
  let partiallyInvoicedItems = 0;
  let fullyInvoicedItems = 0;
  const updatedItems = items.map((item) => ({ ...item }));

  // Update invoice quantities
  filteredItems.forEach((filteredItem, filteredIndex) => {
    const originalIndex = updatedItems.findIndex(
      (item) => item.id === filteredItem.id
    );

    if (originalIndex === -1) return;

    const itemQty = parseFloat(filteredItem[qtyKey] || 0);
    const piInvoicedQty = parseFloat(
      filteredSI[filteredIndex]?.invoice_qty || 0
    );
    const currentInvoicedQty = parseFloat(
      updatedItems[originalIndex].invoice_qty || 0
    );
    const totalInvoicedQty = currentInvoicedQty + piInvoicedQty;

    // Update invoice quantity
    updatedItems[originalIndex].invoice_qty = totalInvoicedQty;
  });

  for (const [index, item] of updatedItems.entries()) {
    if (item.invoice_qty > 0) {
      partiallyInvoicedItems++;
      updatedItems[index].si_status = "Partially Invoiced";
      if (item.invoice_qty >= item[qtyKey]) {
        fullyInvoicedItems++;
        updatedItems[index].si_status = "Fully Invoiced";
      }
    }
  }

  // Determine new PI status
  const allItemsComplete = fullyInvoicedItems === totalItems;
  const anyItemProcessing = partiallyInvoicedItems > 0;
  let newSIStatus = anyItemProcessing
    ? allItemsComplete
      ? "Fully Invoiced"
      : "Partially Invoiced"
    : "";

  return { updatedItems, newSIStatus };
};

// Main execution
(async () => {
  try {
    const data = this.getValues();
    this.showLoading();

    const requiredFields = [
      { name: "plant_id", label: "Plant" },
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

    if (data.acc_integration_type !== null) {
      const canProceed = await checkCreditOverdueLimit(
        data.customer_id,
        data.invoice_total
      );
      if (!canProceed) {
        console.log("Credit/overdue limit check failed");
        this.hideLoading();
        return;
      }
    }

    console.log("Credit/overdue limit check passed");

    if (missingFields.length === 0) {
      const page_status = this.getValue("page_status");

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      const {
        so_id,
        customer_id,
        gd_id,
        sales_invoice_no,
        sales_invoice_date,
        sales_person_id,
        si_payment_term_id,
        si_description,
        plant_id,
        organization_id,
        so_no_display,
        table_si,
        invoice_subtotal,
        invoice_total_discount,
        invoice_taxes_amount,
        invoice_total,
        remarks,
        remarks2,
        remarks3,
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
        billing_address_name,
        billing_address_phone,
        billing_attention,

        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_postal_code,
        shipping_address_country,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,

        exchange_rate,
        myr_total_amount,
        si_ref_doc,

        acc_integration_type,
        last_sync_date,
        customer_credit_limit,
        overdue_limit,
        outstanding_balance,
        overdue_inv_total_amount,
        is_accurate,
        reference_type,
      } = data;

      // Ensure SO IDs and GD numbers are properly handled as arrays
      const soIdArray = Array.isArray(so_id) ? so_id : [so_id];

      const entry = {
        si_status: "Completed",
        posted_status: "Unposted",
        so_id: soIdArray,
        customer_id,
        gd_id,
        sales_invoice_no,
        sales_invoice_date,
        sales_person_id,
        si_payment_term_id,
        si_description,
        plant_id,
        organization_id,
        so_no_display,
        table_si,
        invoice_subtotal,
        invoice_total_discount,
        invoice_taxes_amount,
        invoice_total,
        remarks,
        remarks2,
        remarks3,
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
        billing_address_name,
        billing_address_phone,
        billing_attention,

        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_postal_code,
        shipping_address_country,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,

        exchange_rate,
        myr_total_amount,
        si_ref_doc,

        acc_integration_type,
        last_sync_date,
        customer_credit_limit,
        overdue_limit,
        outstanding_balance,
        overdue_inv_total_amount,
        is_accurate,
        reference_type,
      };

      const latestSI = await processSILineItem(entry);

      if (latestSI.table_si.length === 0) {
        throw new Error(
          "All Invoiced Quantity must not be 0. Please add at lease one item with invoice quantity > 0."
        );
      }

      latestSI.table_si = await fillbackHeaderFields(latestSI);
      console.log("latestSI", latestSI);

      if (page_status === "Add") {
        await addEntry(organizationId, latestSI);
      } else if (page_status === "Edit") {
        const salesInvoiceId = this.getValue("id");
        await updateEntry(organizationId, latestSI, salesInvoiceId);
      }
    } else {
      this.hideLoading();
      this.$message.error(`Missing fields: ${missingFields.join(", ")}`);
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
