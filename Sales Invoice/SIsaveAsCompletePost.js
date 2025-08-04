// Store reference to this for consistent context
const self = this;

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    self.hideLoading();
  }
};

const updateSalesOrderSIStatus = async (
  salesOrderIds,
  tableSI,
  goodsDeliveryNo
) => {
  try {
    console.log("Starting updateSalesOrderSIStatus", {
      salesOrderIds,
      tableSI,
      goodsDeliveryNo,
    });

    const soIds = Array.isArray(salesOrderIds)
      ? salesOrderIds
      : [salesOrderIds];
    console.log("Normalized salesOrderIds:", soIds);

    const updatePromises = soIds.map(async (salesOrderId) => {
      console.log(`Processing salesOrderId: ${salesOrderId}`);

      const resSO = await db
        .collection("sales_order")
        .where({ id: salesOrderId })
        .get();
      console.log(
        `Database query result for salesOrderId ${salesOrderId}:`,
        resSO
      );

      if (!resSO || resSO.data.length === 0) {
        console.log(`No sales order found for salesOrderId: ${salesOrderId}`);
        return;
      }

      const soDoc = resSO.data[0];
      console.log("Sales order document:", soDoc);

      const soItems = soDoc.table_so || [];
      console.log("Sales order items:", soItems);

      const filteredSI = tableSI.filter(
        (item) => item.line_so_no === soDoc.so_no
      );
      console.log("Filtered SI items:", filteredSI);

      const filteredSO = soItems
        .map((item, index) => ({ ...item, originalIndex: index }))
        .filter((item) => item.item_name !== "" || item.so_desc !== "");
      console.log("Filtered SO items with original indices:", filteredSO);

      // Initialize tracking objects
      let totalItems = soItems.length;
      let partiallyInvoicedItems = 0;
      let fullyInvoicedItems = 0;
      console.log("Initial tracking:", {
        totalItems,
        partiallyInvoicedItems,
        fullyInvoicedItems,
      });

      const updatedSoItems = soItems.map((item) => ({ ...item }));
      console.log("Initial updatedSoItems:", updatedSoItems);

      filteredSO.forEach((filteredItem, filteredIndex) => {
        const originalIndex = filteredItem.originalIndex;
        const orderQty = parseFloat(filteredItem.so_quantity || 0);
        const siInvoicedQty = parseFloat(
          filteredSI[filteredIndex]?.invoice_qty || 0
        );
        const currentInvoicedQty = parseFloat(
          updatedSoItems[originalIndex].invoice_qty || 0
        );
        const totalInvoicedQty = currentInvoicedQty + siInvoicedQty;

        console.log(`Processing item at index ${originalIndex}:`, {
          orderQty,
          siInvoicedQty,
          currentInvoicedQty,
          totalInvoicedQty,
        });

        // Update the quantity in the original poItems structure
        updatedSoItems[originalIndex].invoice_qty = totalInvoicedQty;

        // Add ratio for tracking purposes
        updatedSoItems[originalIndex].invoice_ratio =
          orderQty > 0 ? totalInvoicedQty / orderQty : 0;
        console.log(
          `Updated item at index ${originalIndex}:`,
          updatedSoItems[originalIndex]
        );

        if (totalInvoicedQty > 0) {
          partiallyInvoicedItems++;
          console.log(
            `Incremented partiallyInvoicedItems: ${partiallyInvoicedItems}`
          );

          // Count fully delivered items separately
          if (totalInvoicedQty >= orderQty) {
            fullyInvoicedItems++;
            console.log(
              `Incremented fullyInvoicedItems: ${fullyInvoicedItems}`
            );
          }
        }
      });

      let allItemsComplete = fullyInvoicedItems === totalItems;
      let anyItemProcessing = partiallyInvoicedItems > 0;
      console.log("Status checks:", { allItemsComplete, anyItemProcessing });

      let newSIStatus = soDoc.si_status;
      console.log("Current SI status:", newSIStatus);

      if (allItemsComplete) {
        newSIStatus = "Fully Invoiced";
      } else if (anyItemProcessing) {
        newSIStatus = "Partially Invoiced";
      }
      console.log("New SI status:", newSIStatus);

      const updateData = {
        table_so: updatedSoItems,
        si_status: newSIStatus,
      };
      console.log("Update data for sales order:", updateData);

      await db.collection("sales_order").doc(soDoc.id).update(updateData);
      console.log(`Updated sales order document ${soDoc.id}`);
    });

    console.log("Awaiting all update promises");
    await Promise.all(updatePromises);
    console.log("All sales order updates completed");

    if (goodsDeliveryNo) {
      console.log("Processing goods delivery updates:", goodsDeliveryNo);
      goodsDeliveryNo.forEach((gd) => {
        console.log(`Updating goods delivery ${gd}`);
        db.collection("goods_delivery").doc(gd).update({
          si_status: "Fully Invoiced",
        });
        console.log(`Updated goods delivery ${gd}`);
      });
    }

    console.log("updateSalesOrderSIStatus completed successfully");
  } catch (error) {
    console.error("Error in updateSalesOrderSIStatus:", error);
    throw new Error("An error occurred.");
  }
};
// Updated to handle multiple SOs
const updateSalesOrderSIPostedStatus = async (salesInvoiceId) => {
  try {
    console.log("Starting updateSalesOrderSIPostedStatus", { salesInvoiceId });

    const currenctSIQuery = await db
      .collection("sales_invoice")
      .where({ id: salesInvoiceId })
      .get();
    console.log("Sales invoice query result:", currenctSIQuery);

    const currentSI = currenctSIQuery.data[0];
    console.log("Current sales invoice:", currentSI);

    const soIds = Array.isArray(currentSI.so_id)
      ? currentSI.so_id
      : [currentSI.so_id];
    console.log("Normalized sales order IDs:", soIds);

    const tableSI = await currentSI.table_si;
    console.log("Table SI data:", tableSI);

    const updatePromises = soIds.map(async (salesOrderId) => {
      console.log(`Processing salesOrderId: ${salesOrderId}`);

      const resSO = await db
        .collection("sales_order")
        .where({ id: salesOrderId })
        .get();
      console.log(
        `Database query result for salesOrderId ${salesOrderId}:`,
        resSO
      );

      if (!resSO || resSO.data.length === 0) {
        console.log(`No sales order found for salesOrderId: ${salesOrderId}`);
        return;
      }

      const soDoc = resSO.data[0];
      console.log("Sales order document:", soDoc);

      const soItems = soDoc.table_so || [];
      console.log("Sales order items:", soItems);

      const filteredSI = tableSI.filter(
        (item) => item.line_so_no === soDoc.so_no
      );
      console.log("Filtered SI items:", filteredSI);

      const filteredSO = soItems
        .map((item, index) => ({ ...item, originalIndex: index }))
        .filter((item) => item.item_name !== "" || item.so_desc !== "");
      console.log("Filtered SO items with original indices:", filteredSO);

      let totalItems = soItems.length;
      let partiallyPostedItems = 0;
      let fullyPostedItems = 0;
      console.log("Initial tracking:", {
        totalItems,
        partiallyPostedItems,
        fullyPostedItems,
      });

      const updatedSoItems = soItems.map((item) => ({ ...item }));
      console.log("Initial updatedSoItems:", updatedSoItems);

      filteredSO.forEach((filteredItem, filteredIndex) => {
        const originalIndex = filteredItem.originalIndex;
        const orderQty = parseFloat(filteredItem.so_quantity || 0);
        const siPostedQty = parseFloat(
          filteredSI[filteredIndex]?.invoice_qty || 0
        );
        const currentPostedQty = parseFloat(
          updatedSoItems[originalIndex].posted_qty || 0
        );
        const totalPostedQty = currentPostedQty + siPostedQty;

        console.log(`Processing item at index ${originalIndex}:`, {
          orderQty,
          siPostedQty,
          currentPostedQty,
          totalPostedQty,
        });

        // Update the quantity in the original soItems structure
        updatedSoItems[originalIndex].posted_qty = totalPostedQty;

        // Add ratio for tracking purposes
        updatedSoItems[originalIndex].posted_ratio =
          orderQty > 0 ? totalPostedQty / orderQty : 0;
        console.log(
          `Updated item at index ${originalIndex}:`,
          updatedSoItems[originalIndex]
        );

        if (totalPostedQty > 0) {
          partiallyPostedItems++;
          console.log(
            `Incremented partiallyPostedItems: ${partiallyPostedItems}`
          );

          // Count fully delivered items separately
          if (totalPostedQty >= orderQty) {
            fullyPostedItems++;
            console.log(`Incremented fullyPostedItems: ${fullyPostedItems}`);
          }
        }
      });

      let allItemsCompletePosted = fullyPostedItems === totalItems;
      let anyItemProcessingPosted = partiallyPostedItems > 0;
      console.log("Status checks:", {
        allItemsCompletePosted,
        anyItemProcessingPosted,
      });

      let newSIPostedStatus = soDoc.si_posted_status;
      console.log("Current SI posted status:", newSIPostedStatus);

      if (allItemsCompletePosted) {
        newSIPostedStatus = "Fully Posted";
      } else if (anyItemProcessingPosted) {
        newSIPostedStatus = "Partially Posted";
      }
      console.log("New SI posted status:", newSIPostedStatus);

      const updateData = {
        table_so: updatedSoItems,
        si_posted_status: newSIPostedStatus,
      };
      console.log("Update data for sales order:", updateData);

      await db.collection("sales_order").doc(soDoc.id).update(updateData);
      console.log(`Updated sales order document ${soDoc.id}`);
    });

    console.log("Awaiting all update promises");
    await Promise.all(updatePromises);
    console.log("All sales order updates completed");

    console.log("updateSalesOrderSIPostedStatus completed successfully");
  } catch (error) {
    console.error("Error in updateSalesOrderSIPostedStatus:", error);
    throw new Error("An error occurred.");
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

    if (!prefixEntry.data || prefixEntry.data.length === 0) {
      throw new Error("No prefix configuration found for organization");
    }

    return prefixEntry.data[0];
  } catch (error) {
    console.error("Error fetching prefix data:", error);
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
    self.$message.error("Failed to update prefix: " + error.message);
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
      this.setData({ is_posted: 1 });

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
    }

    await db.collection("sales_invoice").add(entry);
    await updateSalesOrderSIStatus(
      entry.so_id,
      entry.table_si,
      entry.goods_delivery_number
    );

    // si line item workflow
    this.runWorkflow(
      "1917950696199892993",
      { sales_invoice_no: entry.sales_invoice_no },
      (res) => {
        console.log("Workflow 1 completed successfully:", res);
      },
      (err) => {
        closeDialog();
        console.error("Workflow 1 failed:", err);
        throw new Error("An error occurred.");
      }
    );

    const accIntegrationType = this.getValue("acc_integration_type");
    console.log("accIntegration", accIntegrationType);
    if (
      accIntegrationType === "SQL Accounting" &&
      organizationId &&
      organizationId !== ""
    ) {
      this.runWorkflow(
        "1925444406441488386",
        { key: "value" },
        (res) => {
          console.log("Post SI Success: ", res);
          const siList = res.data.result;

          siList.forEach(async (si) => {
            if (si.status === "SUCCESS") {
              await this.runWorkflow(
                "1902566784276480001",
                { cust_id: si.cust_id },
                async (res) => {
                  await updateSalesOrderSIPostedStatus(si.id);
                  this.$message.success("Post successfully");
                  closeDialog();
                },
                (err) => {
                  closeDialog();
                  console.error("Post SI Failed: ", err);
                  throw new Error("An error occurred.");
                }
              );
            }
          });
          this.$message.success("Update Sales Invoice successfully");
          closeDialog();
        },
        (err) => {
          closeDialog();
          console.error("Post SI Failed: ", err);
          throw new Error("An error occurred.");
        }
      );
    } else if (
      accIntegrationType === "AutoCount Accounting" &&
      organizationId &&
      organizationId !== ""
    ) {
      this.$message.success("Add Sales Invoice successfully");
      await closeDialog();
    } else if (
      accIntegrationType === "No Accounting Integration" &&
      organizationId &&
      organizationId !== ""
    ) {
      this.$message.success("Add Sales Invoice successfully");
      await closeDialog();
    } else {
      await closeDialog();
    }
  } catch (error) {
    console.error("Error in addEntry:", error);
    self.$message.error(error.message || "Failed to add Sales Invoice");
    self.hideLoading();
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
    }

    await db.collection("sales_invoice").doc(salesInvoiceId).update(entry);
    await updateSalesOrderSIStatus(
      entry.so_id,
      entry.table_si,
      entry.goods_delivery_number
    );

    // si line item workflow
    this.runWorkflow(
      "1917950696199892993",
      { sales_invoice_no: entry.sales_invoice_no },
      (res) => {
        console.log("Workflow 1 completed successfully:", res);
      },
      (err) => {
        closeDialog();
        console.error("Workflow 1 failed:", err);
        console.error(
          "Workflow execution failed: " + (err.message || "Unknown error")
        );
        throw new Error("An error occurred.");
      }
    );

    const accIntegrationType = this.getValue("acc_integration_type");

    if (
      accIntegrationType === "SQL Accounting" &&
      organizationId &&
      organizationId !== ""
    ) {
      this.runWorkflow(
        "1925444406441488386",
        { key: "value" },
        (res) => {
          console.log("Post SI Success: ", res);
          const siList = res.data.result;

          siList.forEach(async (si) => {
            if (si.status === "SUCCESS") {
              await this.runWorkflow(
                "1902566784276480001",
                { cust_id: si.cust_id },
                async (res) => {
                  await updateSalesOrderSIPostedStatus(si.id);
                  this.$message.success("Post successfully");
                  closeDialog();
                },
                (err) => {
                  closeDialog();
                  console.error("Post SI Failed: ", err);
                  throw new Error("An error occurred.");
                }
              );
            }
          });
          this.$message.success("Update Sales Invoice successfully");
          closeDialog();
        },
        (err) => {
          closeDialog();
          console.error("Post SI Failed: ", err);
          throw new Error("An error occurred.");
        }
      );
    } else if (
      accIntegrationType === "AutoCount Accounting" &&
      organizationId &&
      organizationId !== ""
    ) {
      this.$message.success("Add Sales Invoice successfully");
      await closeDialog();
    } else if (
      accIntegrationType === "No Accounting Integration" &&
      organizationId &&
      organizationId !== ""
    ) {
      this.$message.success("Add Sales Invoice successfully");
      await closeDialog();
    } else {
      await closeDialog();
    }
  } catch (error) {
    console.error("Error in updateEntry:", error);
    self.$message.error(error.message || "Failed to update Sales Invoice");
    self.hideLoading();
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

// Main execution
(async () => {
  try {
    const data = self.getValues();
    self.showLoading();

    const requiredFields = [
      { name: "plant_id", label: "Plant" },
      { name: "so_id", label: "SO Number" },
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

    await this.validate("sales_invoice_no");
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
      const page_status = self.getValue("page_status");

      let organizationId = self.getVarGlobal("deptParentId");
      if (!organizationId || organizationId === "0") {
        const deptIds = self.getVarSystem("deptIds");
        if (!deptIds) {
          throw new Error("No valid department ID found");
        }
        organizationId = deptIds.split(",")[0];
      }

      // Ensure so_id and goods_delivery_number are arrays
      const so_id = Array.isArray(data.so_id) ? data.so_id : [data.so_id];
      const goods_delivery_number = Array.isArray(data.goods_delivery_number)
        ? data.goods_delivery_number
        : [data.goods_delivery_number];

      const {
        fake_so_id,
        customer_id,
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
      } = data;

      const entry = {
        si_status: "Completed",
        posted_status: "Pending Post",
        fake_so_id,
        so_id,
        customer_id,
        goods_delivery_number,
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
      };

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        const salesInvoiceId = self.getValue("id");
        if (!salesInvoiceId) {
          throw new Error("Sales Invoice ID is required for editing");
        }
        await updateEntry(organizationId, entry, salesInvoiceId);
      } else {
        throw new Error("Unknown page status: " + page_status);
      }
    } else {
      self.hideLoading();
      self.$message.error(`Missing fields: ${missingFields.join(", ")}`);
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
