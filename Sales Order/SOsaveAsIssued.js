const page_status = this.getParamsVariables("page_status");
const self = this;
const salesOrderId = this.getParamsVariables("sales_order_id");

const closeDialog = () => {
  if (self.parentGenerateForm) {
    self.parentGenerateForm.$refs.SuPageDialogRef.hide();
    self.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

// check credit & overdue limit before doing any process
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

let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}
this.getData()
  .then(async (data) => {
    const {
      so_no,
      so_date,
      customer_name,
      so_currency,
      so_payment_term,
      so_delivery_method,
      organization_id,
      so_shipping_date,
      so_ref_doc,
      plant_name,
      cust_billing_name,
      cust_billing_address,
      cust_cp,
      cust_shipping_address,
      cp_driver_name,
      cp_driver_contact_no,
      cp_vehicle_no,
      cp_pickup_date,
      cs_courier_company,
      cs_shipping_date,
      est_arrival_date,
      ss_tracking_number,
      ct_driver_name,
      ct_driver_contact_no,
      ct_delivery_cost,
      ct_vehicle_number,
      ct_est_delivery_date,
      ss_shipping_company,
      ss_shipping_method,
      ss_shipping_date,
      ss_est_arrival_date,
      ss_freight_charges,
      so_total_gross,
      table_so,
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
      so_sales_person,
      exchange_rate,
      myr_total_amount,
    } = data;

    const canProceed = await checkCreditOverdueLimit(customer_name, so_total);
    if (!canProceed) {
      this.hideLoading();
      return;
    }

    const entry = {
      so_status: "Issued",
      so_no,
      so_date,
      customer_name,
      so_currency,
      so_payment_term,
      so_delivery_method,
      organization_id: organizationId,
      so_shipping_date,
      so_ref_doc,
      plant_name,
      cust_billing_name,
      cust_billing_address,
      cust_cp,
      cust_shipping_address,
      cp_driver_name,
      cp_driver_contact_no,
      cp_vehicle_no,
      cp_pickup_date,
      cs_courier_company,
      cs_shipping_date,
      est_arrival_date,
      ss_tracking_number,
      ct_driver_name,
      ct_driver_contact_no,
      ct_delivery_cost,
      ct_vehicle_number,
      ct_est_delivery_date,
      ss_shipping_company,
      ss_shipping_method,
      ss_shipping_date,
      ss_est_arrival_date,
      ss_freight_charges,
      so_total_gross,
      table_so,
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
      so_sales_person,
      exchange_rate,
      myr_total_amount,
    };

    if (page_status === "Add" || page_status === "Clone") {
      this.showLoading();
      db.collection("sales_order")
        .add(entry)
        .then(() => {
          return db
            .collection("prefix_configuration")
            .where({
              document_types: "Sales Orders",
              is_deleted: 0,
              organization_id: organizationId,
              is_active: 1,
            })
            .get()
            .then((prefixEntry) => {
              if (prefixEntry.data.length === 0) return;
              else {
                const data = prefixEntry.data[0];
                return db
                  .collection("prefix_configuration")
                  .where({
                    document_types: "Sales Orders",
                    is_deleted: 0,
                    organization_id: organizationId,
                  })
                  .update({
                    running_number: parseInt(data.running_number) + 1,
                    has_record: 1,
                  });
              }
            });
        })
        .then(() => {
          closeDialog();
        })
        .catch((error) => {
          this.$message.error(error);
        });
    } else if (page_status === "Edit") {
      this.showLoading();
      const salesOrderId = this.getParamsVariables("sales_order_id");

      const prefixEntry = db
        .collection("prefix_configuration")
        .where({
          document_types: "Sales Orders",
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
        })
        .get()
        .then(async (prefixEntry) => {
          if (prefixEntry.data.length > 0) {
            const prefixData = prefixEntry.data[0];
            const now = new Date();
            let prefixToShow;
            let runningNumber = prefixData.running_number;
            let isUnique = false;
            let maxAttempts = 10;
            let attempts = 0;

            const generatePrefix = (runNumber) => {
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
              return generated;
            };

            const checkUniqueness = async (generatedPrefix) => {
              const existingDoc = await db
                .collection("sales_order")
                .where({ so_no: generatedPrefix })
                .get();
              return existingDoc.data[0] ? false : true;
            };

            const findUniquePrefix = async () => {
              while (!isUnique && attempts < maxAttempts) {
                attempts++;
                prefixToShow = generatePrefix(runningNumber);
                isUnique = await checkUniqueness(prefixToShow);
                if (!isUnique) {
                  runningNumber++;
                }
              }

              if (!isUnique) {
                throw new Error(
                  "Could not generate a unique Sales Order number after maximum attempts"
                );
              } else {
                entry.so_no = prefixToShow;
                db.collection("sales_order").doc(salesOrderId).update(entry);

                db.collection("prefix_configuration")
                  .where({
                    document_types: "Sales Orders",
                    is_deleted: 0,
                    organization_id: organizationId,
                  })
                  .update({
                    running_number: parseInt(runningNumber) + 1,
                    has_record: 1,
                  });
              }
            };

            await findUniquePrefix();
          } else {
            db.collection("sales_order").doc(salesOrderId).update(entry);
          }
        })
        .then(() => {
          closeDialog();
        })
        .catch((error) => {
          this.$message.error(error);
        });
    }
  })
  .catch((error) => {
    this.$message.error(error);
  });
