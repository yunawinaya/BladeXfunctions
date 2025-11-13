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

// Check credit & overdue limit before doing any process
const checkCreditOverdueLimit = async (customer_name, so_total) => {
  try {
    const fetchCustomer = await db
      .collection("Customer")
      .where({ id: customer_name, is_deleted: 0 })
      .get();

    const customerData = fetchCustomer.data[0];
    if (!customerData) {
      console.error(`Customer ${customer_name} not found`);
      this.$message.error(`Customer ${customer_name} not found`);
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
    const soTotal = parseFloat(so_total || 0) || 0;
    const revisedOutstandingAmount = outstandingAmount + soTotal;

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

      // First, collect all applicable control types for Sales Orders
      const applicableControls = controlTypes
        .filter((ct) => ct.document_type === "Sales Orders")
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

const validateQuantity = async (tableSO) => {
  const quantityFailValFields = [];
  const itemFailValFields = [];

  tableSO.forEach((item, index) => {
    if (item.item_name) {
      if (!item.so_quantity || item.so_quantity <= 0) {
        quantityFailValFields.push(`${item.material_name}`);
      }
    } else {
      if (item.so_quantity > 0) {
        itemFailValFields.push(index + 1);
      }
    }
  });

  return { quantityFailValFields, itemFailValFields };
};

const updateItemTransactionDate = async (entry) => {
  try {
    const tableSO = entry.table_so;

    const uniqueItemIds = [
      ...new Set(
        tableSO.filter((item) => item.item_name).map((item) => item.item_name)
      ),
    ];

    const date = new Date().toISOString().split("T")[0];
    for (const [index, item] of uniqueItemIds.entries()) {
      try {
        await db
          .collection("Item")
          .doc(item)
          .update({ last_transaction_date: date });
      } catch {
        throw new Error(
          `Cannot update last transaction date for item #${index + 1}.`
        );
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

const checkExistingGoodsDelivery = async () => {
  const soID = this.getValue("id");

  const resGD = await db
    .collection("goods_delivery")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "so_id",
            operator: "in",
            value: soID,
          },
          {
            prop: "gd_status",
            operator: "equal",
            value: "Draft",
          },
        ],
      },
    ])
    .get();

  if (!resGD || resGD.data.length === 0) return [];
  return resGD.data;
};

const checkExistingSalesInvoice = async () => {
  const soID = this.getValue("id");

  const resSI = await db
    .collection("sales_invoice")
    .filter([
      {
        type: "branch",
        operator: "all",
        children: [
          {
            prop: "so_id",
            operator: "in",
            value: soID,
          },
          {
            prop: "si_status",
            operator: "equal",
            value: "Draft",
          },
        ],
      },
    ])
    .get();

  if (!resSI || resSI.data.length === 0) return [];

  return resSI.data;
};

const fillbackHeaderFields = async (entry) => {
  try {
    for (const [index, soLineItem] of entry.table_so.entries()) {
      soLineItem.plant_id = entry.plant_name || "";
      soLineItem.customer_id = entry.customer_name || "";
      soLineItem.payment_term_id = entry.so_payment_term || "";
      soLineItem.sales_person_id = entry.so_sales_person || "";
      soLineItem.billing_state_id = entry.billing_address_state || "";
      soLineItem.billing_country_id = entry.billing_address_country || "";
      soLineItem.shipping_state_id = entry.shipping_address_state || "";
      soLineItem.shipping_country_id = entry.shipping_address_country || "";
      soLineItem.line_index = index + 1;
      soLineItem.organization_id = entry.organization_id;
      soLineItem.line_status = entry.so_status;
      soLineItem.access_group = entry.access_group || [];
    }
    return entry.table_so;
  } catch {
    throw new Error("Error processing sales order.");
  }
};

const deleteRelatedGD = async (existingGD) => {
  try {
    for (const gd of existingGD) {
      await db.collection("goods_delivery").doc(gd.id).update({
        is_deleted: 1,
      });
    }
  } catch {
    throw new Error("Error in deleting associated goods delivery.");
  }
};

const deleteRelatedSI = async (existingSI) => {
  try {
    for (const si of existingSI) {
      await db.collection("sales_invoice").doc(si.id).update({
        is_deleted: 1,
      });
    }
  } catch {
    throw new Error("Error in deleting associated sales invoice.");
  }
};

const generatePrefix = async (entry) => {
  try {
    let currentPrefix = entry.so_no;
    let organizationID = entry.organization_id;
    let docNoID = entry.document_no_format;
    const status = "Issued";
    let documentTypes = "Sales Orders";

    if (currentPrefix === "<<new>>") {
      const workflowResult = await new Promise((resolve, reject) => {
        this.runWorkflow(
          "1984071042628268034",
          {
            document_type: documentTypes,
            organization_id: organizationID,
            document_no_id: docNoID,
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
        .collection("sales_order")
        .where({ so_no: currentPrefix, organization_id: organizationID })
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

const saveSalesOrders = async (entry) => {
  try {
    const status = this.getValue("so_status");
    const pageStatus = this.getValue("page_status");

    // add status
    if (pageStatus === "Add" || pageStatus === "Clone") {
      entry.so_no = await generatePrefix(entry);
      await db.collection("sales_order").add(entry);
    }
    // edit status
    if (pageStatus === "Edit") {
      // draft status
      if (!status || status === "Draft") {
        entry.so_no = await generatePrefix(entry);
      }
      await db.collection("sales_order").doc(entry.id).update(entry);
    }
  } catch (error) {
    console.error(error.toString());
  }
};
// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading("Saving Sales Order...");

    const data = this.getValues();

    // Get page status and sales order ID
    const page_status = data.page_status;

    // Define required fields
    const requiredFields = [
      { name: "so_no", label: "SO Number" },
      { name: "customer_name", label: "Customer" },
      { name: "plant_name", label: "Plant" },
      { name: "so_date", label: "Sales Order Date" },
      { name: "so_payment_term", label: "Payment Term" },
      {
        name: "table_so",
        label: "SO Items",
        isArray: true,
        arrayType: "object",
        arrayFields: [],
      },
    ];

    // Validate form
    const missingFields = validateForm(data, requiredFields);
    const { quantityFailValFields, itemFailValFields } = await validateQuantity(
      data.table_so
    );

    if (missingFields.length > 0) {
      this.hideLoading();
      throw new Error(`Validation errors: ${missingFields.join(", ")}`);
    } else {
      if (quantityFailValFields.length > 0 || itemFailValFields.length > 0) {
        this.hideLoading();
        await this.$confirm(
          `${
            quantityFailValFields.length > 0
              ? "The following items have quantity less than or equal to zero: " +
                quantityFailValFields.join(", ") +
                "<br><br>"
              : ""
          }
          ${
            itemFailValFields.length > 0
              ? "The following items have quantity but missing item code: Line " +
                itemFailValFields.join(", Line ") +
                "<br><br>"
              : ""
          }
          <strong>If you proceed, these items will be removed from your order. Do you want to continue?</strong>`,
          "Line Item Validation Failed",
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "error",
            dangerouslyUseHTMLString: true,
          }
        ).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving sales order cancelled.");
        });
      }

      this.showLoading();

      // Check credit and overdue limits
      if (data.acc_integration_type !== null) {
        const canProceed = await checkCreditOverdueLimit(
          data.customer_name,
          data.so_total
        );
        if (!canProceed) {
          console.log("Credit/overdue limit check failed");
          this.hideLoading();
          return;
        }
      }

      console.log("Credit/overdue limit check passed");

      // Get organization ID
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      let entry = data;
      entry.so_status = "Issued";

      const latestSO = entry.table_so.filter(
        (item) => item.item_name && item.so_quantity > 0
      );
      entry.table_so = latestSO;

      if (entry.table_so.length === 0) {
        throw new Error(
          "Item Information must not be empty. Please add at least one valid item with quantity > 0"
        );
      }

      entry.table_so = await fillbackHeaderFields(entry);
      for (const [index, _lineItem] of entry.table_so.entries()) {
        await this.validate(`table_so.${index}.so_item_price`);
      }

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        console.log("entry", entry);
        await saveSalesOrders(entry);
      } else if (page_status === "Edit") {
        const currentSOStatus = this.getValue("so_status");

        if (currentSOStatus === "Issued") {
          const existingGD = await checkExistingGoodsDelivery();
          const existingSI = await checkExistingSalesInvoice();

          if (existingGD.length > 0 || existingSI.length > 0) {
            this.hideLoading();
            await this.$confirm(
              `${
                existingGD.length > 0
                  ? "The sales order has existing goods delivery records in draft status. Proceeding will delete all associated goods delivery records.<br><br>"
                  : ""
              }
                ${
                  existingSI.length > 0
                    ? "The sales order has existing sales invoice records in draft status. Proceeding will delete all associated sales invoice records.<br><br>"
                    : ""
                }
                <strong>Do you wish to continue?</strong>`,
              `Existing ${
                existingGD.length && existingSI.length > 0
                  ? "GD and SI"
                  : existingGD.length > 0
                  ? "GD"
                  : existingSI.length > 0
                  ? "SI"
                  : ""
              } detected`,
              {
                confirmButtonText: "Proceed",
                cancelButtonText: "Cancel",
                type: "error",
                dangerouslyUseHTMLString: true,
              }
            ).catch(() => {
              console.log("User clicked Cancel or closed the dialog");
              this.hideLoading();
              throw new Error("Saving sales order cancelled.");
            });

            this.showLoading();
            await deleteRelatedGD(existingGD);
            await deleteRelatedSI(existingSI);
          }
        }

        await saveSalesOrders(entry);
      } else {
        console.log("Unknown page status:", page_status);
        this.hideLoading();
        this.$message.error("Invalid page status");
        return;
      }

      await updateItemTransactionDate(entry);
      if (entry.sqt_id && entry.sqt_id !== "") {
        const sqtID = entry.sqt_id;
        await Promise.all(
          sqtID.map((id) =>
            db.collection("Quotation").doc(id).update({
              sqt_status: "Completed",
            })
          )
        );
      }
      await closeDialog();
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
  } finally {
    console.log("Function execution completed");
  }
})();
