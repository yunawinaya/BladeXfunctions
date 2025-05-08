this.hide("qt_self_pickup");
this.hide("qt_courier_service");
this.hide("qt_company_truck");
this.hide("qt_shipping_service");
this.hide("third_party_transporter");
this.hide([
  "exchange_rate",
  "exchange_rate_myr",
  "exchange_rate_currency",
  "myr_total_amount",
  "total_amount_myr",
]);
this.display("sqt_customer_id");

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

    if (sqtCustomer) {
      await this.setData({ sqt_customer_id: undefined });
      await this.setData({ sqt_customer_id: sqtCustomer });
    }

    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        await setPrefix(organizationId);
        break;

      case "Edit":
        await getPrefixData(organizationId);
        await showStatusHTML(status);
        break;

      case "Clone":
        this.display(["draft_status"]);
        await setPrefix(organizationId);
        break;

      case "View":
        this.hide([
          "link_billing_address",
          "link_shipping_address",
          "button_save_as_draft",
          "button_issued",
          "sqt_customer_id",
        ]);
        this.display(["sqt_customer_id"]);
        await showStatusHTML(status);

        // Disable all form fields in View mode
        this.disabled(
          [
            "sqt_customer_id",
            "currency_code",
            "organization_id",
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
            "driver_contact_no",
            "courier_company",
            "vehicle_number",
            "pickup_date",
            "shipping_date",
            "ct_driver_name",
            "ct_vehicle_number",
            "ct_driver_contact_no",
            "ct_est_delivery_date",
            "ct_delivery_cost",
            "ct_shipping_company",
            "ss_shipping_method",
            "ss_shipping_date",
            "est_arrival_date",
            "ss_freight_charges",
            "ss_tracking_number",
            "sqt_sub_total",
            "sqt_total_discount",
            "sqt_total_tax",
            "sqt_totalsum",
            "sqt_remarks",
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
            "table_sqt",
            "sqt_ref_no",
            "sqt_ref_doc",
            "exchange_rate",
            "myr_total_amount",
          ],
          true
        );

        const totalTax = this.getValue("sqt_total_tax");
        if (totalTax) {
          this.display(["sqt_total_tax"]);
          this.display(["total_tax_currency"]);
        }
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

fixValidityPeriod();
