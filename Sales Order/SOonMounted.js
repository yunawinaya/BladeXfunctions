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

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);
  const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);
  this.setData({ so_no: prefixToShow });
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Sales Orders",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();
  const prefixData = prefixEntry.data[0];

  if (prefixData.is_active === 0) {
    this.disabled(["so_no"], false);
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
    case "Processing":
      this.display(["processing_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
    default:
      break;
  }
};

const displayCurrency = async () => {
  const currencyCode = this.getValue("so_currency");

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

const disabledField = async (status) => {
  if (status !== "Draft") {
    this.disabled(
      [
        "so_status",
        "so_no",
        "so_date",
        "customer_name",
        "so_currency",
        "plant_name",
        "organization_id",
        "partially_delivered",
        "fully_delivered",
        "cust_billing_name",
        "cust_cp",
        "cust_billing_address",
        "cust_shipping_address",
        "so_payment_term",
        "so_delivery_method",
        "so_shipping_date",
        "so_ref_doc",
        "cp_driver_name",
        "cp_driver_contact_no",
        "cp_vehicle_number",
        "cp_pickup_date",
        "cp_ic_no",
        "validity_of_collection",
        "cs_courier_company",
        "cs_shipping_date",
        "est_arrival_date",
        "cs_tracking_number",
        "ct_driver_name",
        "ct_driver_contact_no",
        "ct_delivery_cost",
        "ct_vehicle_number",
        "ct_est_delivery_date",
        "ct_ic_no",
        "ss_shipping_company",
        "ss_shipping_date",
        "ss_freight_charges",
        "ss_shipping_method",
        "ss_est_arrival_date",
        "ss_tracking_number",
        "table_so",
        "so_sales_person",
        "so_total_gross",
        "so_total_discount",
        "so_total_tax",
        "so_total",
        "so_remarks",
        "so_tnc",
        "so_payment_details",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "billing_address_city",
        "billing_address_state",
        "billing_address_country",
        "billing_postal_code",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "shipping_address_city",
        "shipping_address_state",
        "shipping_address_country",
        "shipping_postal_code",
        "exchange_rate",
        "myr_total_amount",
        "sqt_no",
        "tpt_vehicle_number",
        "tpt_transport_name",
        "tpt_ic_no",
        "tpt_driver_contact_no",
      ],
      true
    );

    this.hide([
      "button_save_as_draft",
      "button_save_as_issue",
      "link_billing_address",
      "link_shipping_address",
    ]);
  }
};

const displayDeliveryMethod = async () => {
  const deliveryMethodName = this.getValue("so_delivery_method");
  console.log("deliveryMethodName", deliveryMethodName);

  if (
    deliveryMethodName &&
    typeof deliveryMethodName === "string" &&
    deliveryMethodName.trim() !== "" &&
    deliveryMethodName !== "{}"
  ) {
    this.setData({ delivery_method_text: deliveryMethodName });

    const visibilityMap = {
      "Self Pickup": "self_pickup",
      "Courier Service": "courier_service",
      "Company Truck": "company_truck",
      "Shipping Service": "shipping_service",
      "3rd Party Transporter": "third_party_transporter",
    };

    const selectedField = visibilityMap[deliveryMethodName] || null;
    const fields = [
      "self_pickup",
      "courier_service",
      "company_truck",
      "shipping_service",
      "third_party_transporter",
    ];

    if (!selectedField) {
      this.hide(fields);
    } else {
      fields.forEach((field) => {
        field === selectedField ? this.display(field) : this.hide(field);
      });
    }
  } else {
    this.setData({ delivery_method_text: "" });

    const fields = [
      "self_pickup",
      "courier_service",
      "company_truck",
      "shipping_service",
      "third_party_transporter",
    ];
    this.hide(fields);
  }
};

const displayTax = async () => {
  const totalTax = this.getValue("so_total_tax");

  if (totalTax > 0.0) {
    this.display(["so_total_tax", "total_tax_currency"]);
  }
};

(async () => {
  try {
    const status = await this.getValue("so_status");
    const soCustomer = this.getValue("customer_name");

    if (soCustomer && !Array.isArray(soCustomer)) {
      this.display("address_grid");
    }
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

    const customerName = this.getValue("customer_name");

    if (customerName) {
      await this.setData({ customer_name: undefined });
      await this.setData({ customer_name: customerName });
    }

    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        await setPrefix(organizationId);
        this.setData({ so_date: new Date().toISOString().split("T")[0] });
        break;

      case "Edit":
        await disabledField(status);
        await getPrefixData(organizationId);
        await showStatusHTML(status);
        await displayCurrency();
        await displayTax();
        await displayDeliveryMethod();
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }
        break;

      case "Clone":
        this.display(["draft_status"]);
        this.setData({ so_date: new Date().toISOString().split("T")[0] });
        await setPrefix(organizationId);
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }
        break;

      case "View":
        this.hide([
          "button_save_as_draft",
          "button_save_as_issue",
          "link_billing_address",
          "link_shipping_address",
          "customer_name",
        ]);
        this.display(["customer_name"]);
        await displayCurrency();
        await displayTax();
        await showStatusHTML(status);
        await displayDeliveryMethod();
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
