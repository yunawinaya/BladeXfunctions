const fixValidityPeriod = () => {
  // Check if we're in edit or view mode
  if (this.isEdit || this.isView) {
    setTimeout(() => {
      // Get the current value
      const validityPeriod = this.getValue("sqt_validity_period");

      // If it's malformed (empty array with object, causing the Long conversion error)
      if (
        Array.isArray(validityPeriod) &&
        validityPeriod.length > 0 &&
        typeof validityPeriod[0] === "object" &&
        Object.keys(validityPeriod[0]).length === 0
      ) {
        // Reset it to empty array
        this.setData({ sqt_validity_period: [] });
        console.log("Fixed malformed validity period");
      }
    }, 500); // Short delay to ensure the form has loaded
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
    .collection("Quotation")
    .where({ sqt_no: generatedPrefix, organization_id: organizationId })
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
      "Could not generate a unique Quotation number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);
  let newPrefix = "";

  if (prefixData.is_active === 1) {
    const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);
    newPrefix = prefixToShow;
  }
  this.setData({ sqt_no: newPrefix });
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Quotations",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();
  const prefixData = prefixEntry.data[0];

  if (prefixData.is_active === 0) {
    this.disabled(["sqt_no"], false);
  }

  return prefixData;
};

const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Issued":
      this.display(["issued_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
    default:
      break;
  }
};

const displayDeliveryMethod = async () => {
  const deliveryMethodName = this.getValue("sqt_delivery_method_id");
  if (deliveryMethodName) {
    this.setData({ delivery_method_text: deliveryMethodName });

    const visibilityMap = {
      "Self Pickup": "qt_self_pickup",
      "Courier Service": "qt_courier_service",
      "Company Truck": "qt_company_truck",
      "Shipping Service": "qt_shipping_service",
      "3rd Party Transporter": "third_party_transporter",
    };

    const selectedField = visibilityMap[deliveryMethodName] || null;
    const fields = [
      "qt_self_pickup",
      "qt_courier_service",
      "qt_company_truck",
      "qt_shipping_service",
      "third_party_transporter",
    ];

    if (!selectedField) {
      this.hide(fields);
    }
    fields.forEach((field) => {
      field === selectedField ? this.display(field) : this.hide(field);
    });
  }
};

const displayCurrency = async () => {
  const currencyCode = this.getValue("currency_code");

  if (currencyCode !== "----" && currencyCode !== "MYR" && currencyCode) {
    this.display([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);
  }

  this.setData({
    total_gross_currency: currencyCode,
    total_discount_currency: currencyCode,
    total_tax_currency: currencyCode,
    total_amount_currency: currencyCode,
    exchange_rate_currency: currencyCode,
  });
};

const displayTax = async () => {
  const totalTax = this.getValue("sqt_total_tax");

  if (totalTax > 0.0) {
    this.display(["sqt_total_tax", "total_tax_currency"]);
  }
};

const enabledUOMField = async () => {
  const tableSQT = this.getValue("table_sqt");

  tableSQT.forEach((sqt, rowIndex) => {
    if (sqt.material_id || sqt.sqt_desc !== "") {
      this.triggerEvent("onChange_Item", { sqtItem: sqt, index: rowIndex });
      this.disabled([`table_sqt.${rowIndex}.sqt_order_uom_id`], false);
    }
  });
};

const disabledField = async (status) => {
  if (status !== "Draft" && status !== "Issued") {
    this.disabled(
      [
        "sqt_status",
        "organization_id",
        "validity_of_collection",
        "sqt_ref_doc",
        "sqt_customer_id",
        "currency_code",
        "sqt_billing_name",
        "sqt_billing_address",
        "sqt_billing_cp",
        "sqt_shipping_address",
        "sqt_no",
        "sqt_plant",
        "sqt_date",
        "sqt_validity_period",
        "sales_person_id",
        "sqt_payment_term",
        "sqt_delivery_method_id",
        "cp_customer_pickup",
        "cp_ic_no",
        "driver_contact_no",
        "courier_company",
        "vehicle_number",
        "pickup_date",
        "shipping_date",
        "ct_driver_name",
        "ct_ic_no",
        "ct_vehicle_number",
        "ct_driver_contact_no",
        "ct_est_delivery_date",
        "ct_delivery_cost",
        "ss_shipping_company",
        "ss_shipping_method",
        "ss_shipping_date",
        "est_arrival_date",
        "ss_freight_charges",
        "ss_tracking_number",
        "tpt_vehicle_number",
        "tpt_transport_name",
        "tpt_ic_no",
        "tpt_driver_contact_no",
        "sqt_sub_total",
        "sqt_total_discount",
        "sqt_total_tax",
        "sqt_totalsum",
        "sqt_remarks",
        "table_sqt",
        "sqt_ref_no",
        "exchange_rate",
        "myr_total_amount",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "billing_address_city",
        "billing_address_state",
        "billing_postal_code",
        "billing_address_country",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "shipping_address_city",
        "shipping_address_state",
        "shipping_postal_code",
        "shipping_address_country",
      ],
      true
    );

    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_issued",
    ]);
  } else if (status === "Issued") {
    this.hide("button_save_as_draft");
  }
};

const displayCustomerType = async () => {
  const customerType = this.getValue("customer_type");

  if (customerType) {
    if (customerType === "Existing Customer") {
      this.display("customer_grid");
      this.hide("new_customer_grid");
    } else if (customerType === "New Customer") {
      this.hide("customer_grid");
      this.display("new_customer_grid");
    }
  }
};

const checkAccIntegrationType = async (organizationId) => {
  if (organizationId) {
    const resAI = await db
      .collection("accounting_integration")
      .where({ organization_id: organizationId })
      .get();

    if (resAI && resAI.data.length > 0) {
      const aiData = resAI.data[0];

      this.setData({ acc_integration_type: aiData.acc_integration_type });
    }
  }
};

const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];

  if (currentDept === organizationId) {
    this.disabled("sqt_plant", false);

    if (pageStatus === "Add" || pageStatus === "Clone") {
      this.setData({ sqt_plant: currentDept });
    }
  } else {
    this.disabled("sqt_plant", true);

    if (pageStatus === "Add" || pageStatus === "Clone") {
      this.setData({ sqt_plant: currentDept });
    }
  }
};

const fetchUnrestrictedQty = async () => {
  try {
    console.log("fetchUnrestrictedQty");
    const tableSQT = this.getValue("table_sqt");
    const plantId = this.getValue("sqt_plant");
    const organizationId = this.getValue("organization_id");

    console.log("tableSQT", tableSQT);

    if (tableSQT.length > 0) {
      // 创建更新数据的对象，避免在循环中多次调用setData
      const updateData = {};

      for (const [index, sqt] of tableSQT.entries()) {
        const itemId = sqt.material_id;

        let totalUnrestrictedQtyBase = 0;

        let item_batch_management = 0;
        let serial_number_management = 0;
        let stock_control = 0;

        await db
          .collection("Item")
          .where({ id: itemId })
          .get()
          .then((res) => {
            const itemData = res.data[0];
            item_batch_management = itemData.item_batch_management;
            serial_number_management = itemData.serial_number_management;
            stock_control = itemData.stock_control;
          });

        if (serial_number_management === 1) {
          const resSerialBalance = await db
            .collection("item_serial_balance")
            .where({
              material_id: itemId,
              ...(plantId !== organizationId
                ? { plant_id: plantId || null }
                : {}),
              organization_id: organizationId,
            })
            .get();
          console.log("wzplog", resSerialBalance);
          if (resSerialBalance && resSerialBalance.data.length > 0) {
            const serialBalanceData = resSerialBalance.data;

            totalUnrestrictedQtyBase = serialBalanceData.reduce(
              (sum, balance) => sum + (balance.unrestricted_qty || 0),
              0
            );
          }
        } else if (
          (serial_number_management !== 1 || !serial_number_management) &&
          item_batch_management === 1 &&
          (stock_control !== 0 || stock_control)
        ) {
          const resBatchBalance = await db
            .collection("item_batch_balance")
            .where({
              material_id: itemId,
              ...(plantId !== organizationId
                ? { plant_id: plantId || null }
                : {}),
              organization_id: organizationId,
            })
            .get();

          if (resBatchBalance && resBatchBalance.data.length > 0) {
            const batchBalanceData = resBatchBalance.data;

            totalUnrestrictedQtyBase = batchBalanceData.reduce(
              (sum, balance) => sum + (balance.unrestricted_qty || 0),
              0
            );
          }
        } else if (
          (serial_number_management !== 1 || !serial_number_management) &&
          (item_batch_management !== 1 || !item_batch_management) &&
          (stock_control !== 0 || stock_control)
        ) {
          const resBalance = await db
            .collection("item_balance")
            .where({
              material_id: itemId,
              ...(plantId !== organizationId
                ? { plant_id: plantId || null }
                : {}),
              organization_id: organizationId,
            })
            .get();

          if (resBalance && resBalance.data.length > 0) {
            const balanceData = resBalance.data;

            totalUnrestrictedQtyBase = balanceData.reduce(
              (sum, balance) => sum + (balance.unrestricted_qty || 0),
              0
            );
          }
        } else {
          console.log("No stock control for item", itemId);
          totalUnrestrictedQtyBase = 0;
        }

        console.log("totalUnrestrictedQtyBase", totalUnrestrictedQtyBase);
        console.log("index", index);

        // 将更新数据添加到对象中，而不是立即调用setData
        updateData[`table_sqt.${index}.unrestricted_qty`] =
          totalUnrestrictedQtyBase;
      }

      // 循环结束后一次性更新所有数据
      this.setData(updateData);
    }
  } catch (error) {
    console.error(error);
  }
};

(async () => {
  try {
    const status = await this.getValue("sqt_status");

    let pageStatus = "";

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ organization_id: organizationId, page_status: pageStatus });
    this.hide([
      "exchange_rate",
      "exchange_rate_myr",
      "exchange_rate_currency",
      "myr_total_amount",
      "total_amount_myr",
    ]);

    const customerType = this.getValue("customer_type");
    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        await setPrefix(organizationId);
        await checkAccIntegrationType(organizationId);
        await setPlant(organizationId, pageStatus);
        this.setData({ sqt_date: new Date().toISOString().split("T")[0] });
        break;

      case "Edit":
        if (customerType === "Existing Customer") {
          const sqtCustomer = this.getValue("sqt_customer_id");
          if (sqtCustomer) {
            this.display("address_grid");
          }
        }
        await enabledUOMField();
        await checkAccIntegrationType(organizationId);
        await displayCustomerType();
        await getPrefixData(organizationId);
        await setPlant(organizationId, pageStatus);
        await disabledField(status);
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await displayTax();
        await displayCurrency();
        await fixValidityPeriod();
        await fetchUnrestrictedQty();
        //await setUOM();
        break;

      case "Clone":
        if (customerType === "Existing Customer") {
          const sqtCustomer = this.getValue("sqt_customer_id");
          if (sqtCustomer) {
            this.display("address_grid");
          }
        }

        console.log("Cloning record", this.getValues());
        await setPlant(organizationId, pageStatus);
        this.setData({ sqt_date: new Date().toISOString().split("T")[0] });
        this.display(["draft_status"]);
        await checkAccIntegrationType(organizationId);
        await setPrefix(organizationId);
        await displayDeliveryMethod();
        await displayTax();
        await displayCustomerType();
        await displayCurrency();
        await fixValidityPeriod();
        await enabledUOMField();
        await fetchUnrestrictedQty();
        //await setUOM();
        break;

      case "View":
        console.log("Viewing record", this.getValues());
        if (customerType === "Existing Customer") {
          const sqtCustomer = this.getValue("sqt_customer_id");
          if (sqtCustomer) {
            this.display("address_grid");
          }
        }
        this.hide([
          "link_billing_address",
          "link_shipping_address",
          "button_save_as_draft",
          "button_issued",
          "sqt_customer_id",
        ]);
        this.display(["sqt_customer_id"]);
        await displayCustomerType();
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await displayCurrency();
        await fixValidityPeriod();
        await displayTax();
        //await setUOM();
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
