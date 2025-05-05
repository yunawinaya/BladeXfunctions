this.hide([
  "self_pickup",
  "courier_service",
  "company_truck",
  "shipping_service",
  "third_party_transporter",
]);
this.hide([
  "exchange_rate",
  "exchange_rate_myr",
  "exchange_rate_currency",
  "myr_total_amount",
  "total_amount_myr",
]);

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
    .collection("sales_order")
    .where({ so_no: generatedPrefix })
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
      "Could not generate a unique Sales Order number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);
  const { prefixToShow } = await findUniquePrefix(prefixData);
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

(async () => {
  try {
    const status = await this.getValue("so_status");

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
        break;

      case "Edit":
        await getPrefixData(organizationId);
        await showStatusHTML(status);
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }
        this.display("address_grid");
        break;

      case "Clone":
        this.display(["draft_status"]);
        await setPrefix(organizationId);
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }
        this.display("address_grid");
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
        await showStatusHTML(status);
        if (this.getValue("sqt_no")) {
          this.display("sqt_no");
        }
        this.display("address_grid");

        // Disable all form fields in View mode
        this.disabled(
          [
            "so_status",
            "sqt_no",
            "so_no",
            "so_date",
            "customer_name",
            "so_currency",
            "plant_name",
            "organization_id",
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
            "cs_courier_company",
            "cs_shipping_date",
            "est_arrival_date",
            "ct_driver_name",
            "ct_driver_contact_no",
            "ct_delivery_cost",
            "ct_vehicle_number",
            "ct_est_delivery_date",
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
          ],
          true
        );
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
