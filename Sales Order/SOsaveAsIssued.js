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

// Check credit & overdue limit before doing any process
const checkCreditOverdueLimit = async (customer_name, so_total) => {
  try {
    const fetchCustomer = await db
      .collection("customer")
      .where({ customer_name, is_deleted: 0 })
      .get();

    const customerData = fetchCustomer.data[0];
    if (!customerData) {
      console.error(`Customer ${customer_name} not found`);
      return false;
    }

    const controlTypes = customerData.control_type_list;
    const isAccurate = customerData.is_accurate;
    const outstandingAmount = parseFloat(customerData.outstanding_balance || 0);
    const overdueAmount = parseFloat(customerData.overdue_inv_total_am || 0);
    const overdueLimit = parseFloat(customerData.overdue_limit || 0);
    const creditLimit = parseFloat(customerData.customer_credit_limit || 0);
    const revisedOutstandingAmount =
      outstandingAmount + parseFloat(so_total || 0);

    // Helper function to show popup with appropriate messages and data
    const showLimitDialog = (
      type,
      includeCredit = false,
      includeOverdue = false,
      isBlock = true
    ) => {
      this.openDialog("dialog_credit_limit");

      const alerts = {
        credit: "alert_credit_limit",
        overdue: "alert_overdue_limit",
        both: "alert_credit_overdue",
        suspended: "alert_suspended",
      };

      const texts = {
        credit: "text_credit_limit",
        overdue: "text_overdue_limit",
        both: "text_credit_overdue",
        suspended: "text_suspended",
      };

      const alertType = type;

      this.display(`dialog_credit_limit.${alerts[alertType]}`);
      this.display(`dialog_credit_limit.${texts[alertType]}`);

      const dataToSet = {};

      if (includeCredit) {
        this.display("dialog_credit_limit.total_allowed_credit");
        this.display("dialog_credit_limit.total_credit");
        dataToSet["dialog_credit_limit.total_allowed_credit"] = creditLimit;
        dataToSet["dialog_credit_limit.total_credit"] =
          revisedOutstandingAmount;
      }

      if (includeOverdue) {
        this.display("dialog_credit_limit.total_allowed_overdue");
        this.display("dialog_credit_limit.total_overdue");
        dataToSet["dialog_credit_limit.total_allowed_overdue"] = overdueLimit;
        dataToSet["dialog_credit_limit.total_overdue"] = overdueAmount;
      }

      this.display(
        `dialog_credit_limit.text_${
          isBlock ? (includeCredit && includeOverdue ? "3" : "1") : "4"
        }`
      );

      if (isBlock) {
        this.display("dialog_credit_limit.button_back");
      } else {
        this.display("dialog_credit_limit.button_yes");
        this.display("dialog_credit_limit.button_no");
      }

      this.setData(dataToSet);

      return false;
    };

    // Check if accuracy flag is set
    if (controlTypes) {
      if (isAccurate === 0) {
        this.openDialog("dialog_sync_customer");
        return false;
      }

      // Define control type behaviors
      const controlTypeChecks = {
        // Check overdue limit (block)
        1: () => {
          if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, true);
          }
          return true;
        },

        // Check overdue limit (override)
        2: () => {
          if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, false);
          }
          return true;
        },

        // Check credit limit (block)
        3: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, true);
          }
          return true;
        },

        // Check both limits (block)
        4: () => {
          if (
            revisedOutstandingAmount > creditLimit &&
            overdueAmount > overdueLimit
          ) {
            return showLimitDialog("both", true, true, true);
          } else if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, true);
          } else if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, true);
          }
          return true;
        },

        // Check both limits (credit block, overdue override)
        5: () => {
          if (
            revisedOutstandingAmount > creditLimit &&
            overdueAmount > overdueLimit
          ) {
            return showLimitDialog("both", true, true, true);
          } else if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, true);
          } else if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, false);
          }
          return true;
        },

        // Check credit limit (override)
        6: () => {
          if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, false);
          }
          return true;
        },

        // Check both limits (credit override, overdue block)
        7: () => {
          if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, true);
          } else if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, false);
          }
          return true;
        },

        // Check both limits (credit override, overdue override)
        8: () => {
          if (
            revisedOutstandingAmount > creditLimit &&
            overdueAmount > overdueLimit
          ) {
            return showLimitDialog("both", true, true, false);
          } else if (revisedOutstandingAmount > creditLimit) {
            return showLimitDialog("credit", true, false, false);
          } else if (overdueAmount > overdueLimit) {
            return showLimitDialog("overdue", false, true, false);
          }
          return true;
        },

        9: () => {
          return showLimitDialog("suspended", false, false, true);
        },
      };

      // Check each control type that applies to Sales Orders
      for (const controlType of controlTypes) {
        const { control_type, document_type } = controlType;
        if (
          document_type === "Sales Orders" &&
          controlTypeChecks[control_type]
        ) {
          const result = controlTypeChecks[control_type]();
          if (result !== true) {
            return result; // Return false if a limit check fails
          }
        }
      }

      // All checks passed
      return true;
    } else {
      console.log("No control type defined for customer");
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

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      entry.so_no = prefixToShow;
      await updatePrefix(organizationId, runningNumber);
    }

    await db.collection("sales_order").add(entry);
    // await this.runWorkflow(
    //   "1917416028010524674",
    //   { so_no: entry.so_no },
    //   async (res) => {
    //     console.log("成功结果：", res);
    //   },
    //   (err) => {
    //     console.error("失败结果：", err);
    //     closeDialog();
    //   }
    // );
    this.$message.success("Add successfully");
    await closeDialog();
  } catch (error) {
    console.error("Error in addEntry:", error);
    throw error;
  }
};

const updateEntry = async (organizationId, entry, salesOrderId) => {
  try {
    const prefixData = await getPrefixData(organizationId);

    if (prefixData.length !== 0) {
      const { prefixToShow, runningNumber } = await findUniquePrefix(
        prefixData,
        organizationId
      );

      await updatePrefix(organizationId, runningNumber);

      entry.so_no = prefixToShow;
    }

    await db.collection("sales_order").doc(salesOrderId).update(entry);
    // await this.runWorkflow(
    //   "1917416028010524674",
    //   { so_no: entry.so_no },
    //   async (res) => {
    //     console.log("成功结果：", res);
    //   },
    //   (err) => {
    //     alert();
    //     console.error("失败结果：", err);
    //     closeDialog();
    //   }
    // );

    this.$message.success("Update successfully");
    await closeDialog();
  } catch (error) {
    console.error("Error in updateEntry:", error);
    throw error;
  }
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
        arrayFields: [{ name: "so_quantity", label: "Quantity" }],
      },
    ];

    // Validate form
    const missingFields = validateForm(data, requiredFields);

    // Check credit and overdue limits
    // const canProceed = await checkCreditOverdueLimit(
    //   data.customer_name,
    //   data.so_total
    // );
    // if (!canProceed) {
    //   console.log("Credit/overdue limit check failed");
    //   this.hideLoading();
    //   return;
    // }

    // console.log("Credit/overdue limit check passed");

    if (missingFields.length === 0) {
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
        ss_shipping_date,
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
        ct_driver_name,
        ct_driver_contact_no,
        ct_delivery_cost,
        ct_vehicle_number,
        ct_est_delivery_date,
        ct_ic_no,
        ss_shipping_company,
        ss_shipping_date,
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
      };

      // Add or update based on page status
      if (page_status === "Add" || page_status === "Clone") {
        await addEntry(organizationId, entry);
      } else if (page_status === "Edit") {
        await updateEntry(organizationId, entry, sales_order_id);
      } else {
        console.log("Unknown page status:", page_status);
        this.hideLoading();
        this.$message.error("Invalid page status");
        return;
      }
    } else {
      this.hideLoading();
      this.$message.error(`Validation errors: ${missingFields.join(", ")}`);
    }
  } catch (error) {
    console.error("Error in main function:", error);
    this.hideLoading();
    this.$message.error(
      error.message || "An error occurred while processing the sales order"
    );
  } finally {
    console.log("Function execution completed");
  }
})();
