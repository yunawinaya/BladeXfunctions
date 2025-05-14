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

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("Quotation")
    .where({ sqt_no: generatedPrefix })
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
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
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
  const { prefixToShow } = await findUniquePrefix(prefixData);
  this.setData({ sqt_no: prefixToShow });
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

const setUOM = async () => {
  const allUOMData = await db.collection("unit_of_measurement").get();

  const tableSQT = this.getValue("table_sqt");

  const uomOptions = [];

  for (let i = 0; i < tableSQT.length; i++) {
    const uom = tableSQT[i].sqt_order_uom_id;
    for (let j = 0; j < allUOMData.data.length; j++) {
      if (allUOMData.data[j].id === uom) {
        uomOptions.push({
          value: allUOMData.data[j].id,
          label: allUOMData.data[j].uom_name,
        });
      }
    }
    this.setOptionData([`table_sqt.${i}.sqt_order_uom_id`], uomOptions);
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

  if (currencyCode !== "----" && currencyCode !== "MYR") {
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

    const sqtCustomer = this.getValue("sqt_customer_id");

    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        await setPrefix(organizationId);
        break;

      case "Edit":
        if (sqtCustomer) {
          this.display("address_grid");
        }
        await getPrefixData(organizationId);
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await displayCurrency();
        await fixValidityPeriod();
        await setUOM();
        break;

      case "Clone":
        if (sqtCustomer) {
          this.display("address_grid");
        }
        this.display(["draft_status"]);
        await setPrefix(organizationId);
        break;

      case "View":
        if (sqtCustomer) {
          this.display("address_grid");
        }
        this.hide([
          "link_billing_address",
          "link_shipping_address",
          "button_save_as_draft",
          "button_issued",
          "sqt_customer_id",
        ]);
        this.display(["sqt_customer_id"]);
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await displayCurrency();
        await fixValidityPeriod();
        await setUOM();
        const totalTax = this.getValue("sqt_total_tax");
        if (totalTax) {
          this.display(["sqt_total_tax", "total_tax_currency"]);
        }
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
