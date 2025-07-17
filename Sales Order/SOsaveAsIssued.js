const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const getPrefixData = async (organizationId) => {
  console.log("Getting prefix data for organization:", organizationId);
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Sales Orders",
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

const updatePrefix = async (organizationId, runningNumber) => {
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
        document_types: "Sales Orders",
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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("sales_order")
    .where({ so_no: generatedPrefix, organization_id: organizationId })
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
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Sales Order number after maximum attempts"
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

const addEntry = async (organizationId, entry) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData !== null) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      entry.so_no = prefixToShow;
      await updatePrefix(organizationId, runningNumber);
    }

    await db.collection("sales_order").add(entry);
    await this.runWorkflow(
      "1917416028010524674",
      { so_no: entry.so_no },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        console.error("失败结果：", err);
        closeDialog();
      }
    );
    this.$message.success("Add successfully");
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, entry, salesOrderId) => {
  try {
    const currentSOStatus = this.getValue("so_status");

    if (!currentSOStatus || currentSOStatus === "Draft") {
      const prefixData = await getPrefixData(organizationId);

      if (prefixData !== 0) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId
        );

        await updatePrefix(organizationId, runningNumber);

        entry.so_no = prefixToShow;
      }
    }

    await db.collection("sales_order").doc(salesOrderId).update(entry);
    await this.runWorkflow(
      "1917416028010524674",
      { so_no: entry.so_no },
      async (res) => {
        console.log("成功结果：", res);
      },
      (err) => {
        alert();
        console.error("失败结果：", err);
        closeDialog();
      }
    );

    this.$message.success("Update successfully");
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

const validateQuantity = async (tableSO) => {
  const quantityFailValFields = [];
  const itemFailValFields = [];

  tableSO.forEach((item, index) => {
    if (item.item_name || item.so_desc) {
      if (item.so_quantity <= 0) {
        quantityFailValFields.push(`${item.material_name || item.so_desc}`);
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

    const date = new Date().toISOString();
    for (const [index, item] of uniqueItemIds.entries()) {
      try {
        await db
          .collection("Item")
          .doc(item)
          .update({ last_transaction_date: date });
      } catch (error) {
        throw new Error(
          `Cannot update last transaction date for item #${index + 1}.`,
          error
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
        prop: "so_id",
        operator: "in",
        value: soID,
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
        prop: "so_id",
        operator: "in",
        value: soID,
      },
    ])
    .get();

  if (!resSI || resSI.data.length === 0) return [];

  return resSI.data;
};

// Main execution wrapped in an async IIFE
(async () => {
  try {
    this.showLoading();

    const data = this.getValues();

    // Get page status and sales order ID
    const page_status = data.page_status;
    const sales_order_id = data.id;

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

    await this.validate("so_no");

    if (
      missingFields.length === 0 &&
      quantityFailValFields.length === 0 &&
      itemFailValFields.length === 0
    ) {
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

      const {
        so_no,
        so_date,
        customer_name,
        so_currency,
        plant_name,
        partially_delivered,
        fully_delivered,
        cust_billing_address,
        cust_shipping_address,
        so_payment_term,
        so_delivery_method,
        so_shipping_date,
        so_ref_doc,
        cp_driver_name,
        cp_driver_contact_no,
        cp_vehicle_number,
        cp_pickup_date,
        cp_ic_no,
        validity_of_collection,
        cs_courier_company,
        cs_shipping_date,
        est_arrival_date,
        cs_tracking_number,
        ct_driver_name,
        ct_driver_contact_no,
        ct_delivery_cost,
        ct_vehicle_number,
        ct_est_delivery_date,
        ct_ic_no,
        ss_shipping_company,
        ss_shippping_date,
        ss_freight_charges,
        ss_shipping_method,
        ss_est_arrival_date,
        ss_tracking_number,
        table_so,
        so_sales_person,
        so_total_gross,
        so_total_discount,
        so_total_tax,
        so_total,
        so_remarks,
        so_tnc,
        so_payment_details,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_address_country,
        billing_postal_code,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_postal_code,
        exchange_rate,
        myr_total_amount,
        sqt_no,
        tpt_vehicle_number,
        tpt_transport_name,
        tpt_ic_no,
        tpt_driver_contact_no,
        cs_freight_charges,
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
        acc_integration_type,
        last_sync_date,
        customer_credit_limit,
        overdue_limit,
        outstanding_balance,
        overdue_inv_total_amount,
        is_accurate,
      } = data;

      const entry = {
        so_status: "Issued",
        so_no,
        so_date,
        customer_name,
        so_currency,
        plant_name,
        organization_id: organizationId,
        partially_delivered,
        fully_delivered,
        cust_billing_address,
        cust_shipping_address,
        so_payment_term,
        so_delivery_method,
        so_shipping_date,
        so_ref_doc,

        cp_driver_name,
        cp_driver_contact_no,
        cp_vehicle_number,
        cp_pickup_date,
        cp_ic_no,
        validity_of_collection,

        cs_courier_company,
        cs_shipping_date,
        est_arrival_date,
        cs_tracking_number,
        cs_freight_charges,

        ct_driver_name,
        ct_driver_contact_no,
        ct_delivery_cost,
        ct_vehicle_number,
        ct_est_delivery_date,
        ct_ic_no,

        ss_shipping_company,
        ss_shippping_date,
        ss_freight_charges,
        ss_shipping_method,
        ss_est_arrival_date,
        ss_tracking_number,

        table_so,
        so_sales_person,
        so_total_gross,
        so_total_discount,
        so_total_tax,
        so_total,
        so_remarks,
        so_tnc,
        so_payment_details,
        billing_address_line_1,
        billing_address_line_2,
        billing_address_line_3,
        billing_address_line_4,
        billing_address_city,
        billing_address_state,
        billing_address_country,
        billing_postal_code,
        shipping_address_line_1,
        shipping_address_line_2,
        shipping_address_line_3,
        shipping_address_line_4,
        shipping_address_city,
        shipping_address_state,
        shipping_address_country,
        shipping_postal_code,
        exchange_rate,
        myr_total_amount,
        sqt_no,
        tpt_vehicle_number,
        tpt_transport_name,
        tpt_ic_no,
        tpt_driver_contact_no,
        billing_address_name,
        billing_address_phone,
        billing_attention,
        shipping_address_name,
        shipping_address_phone,
        shipping_attention,
        acc_integration_type,
        last_sync_date,
        customer_credit_limit,
        overdue_limit,
        outstanding_balance,
        overdue_inv_total_amount,
        is_accurate,
      };

      const latestSO = entry.table_so.filter(
        (item) => (item.item_name || item.so_desc) && item.so_quantity > 0
      );
      entry.table_so = latestSO;

      if (entry.table_so.length === 0) {
        throw new Error(
          "Item Information must not be empty. Please add at least one valid item with quantity > 0"
        );
      }

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        const currentSOStatus = this.getValue("so_status");

        if (currentSOStatus === "Issued") {
          const existingGD = await checkExistingGoodsDelivery();
          const existingSI = await checkExistingSalesInvoice();

          if (existingGD.length > 0 || existingSI.length > 0) {
            this.hideLoading();
            this.openDialog("auto_delete_dialog");

            if (existingGD.length > 0 && existingSI.length === 0) {
              this.display("text_gd");
              this.hide("text_si");
            } else if (existingGD.length === 0 && existingSI.length > 0) {
              this.display("text_si");
              this.hide("text_gd");
            } else {
              this.display(["text_si", "text_gd"]);
            }

            return;
          }
        }

        await updateEntry(organizationId, entry, sales_order_id);
      } else {
        console.log("Unknown page status:", page_status);
        this.hideLoading();
        this.$message.error("Invalid page status");
        return;
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
  } finally {
    console.log("Function execution completed");
  }
})();
