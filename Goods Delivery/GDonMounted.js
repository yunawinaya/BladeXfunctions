// Helper functions
const generatePrefix = (prefixData) => {
  const now = new Date();
  let prefixToShow = prefixData.current_prefix_config;

  prefixToShow = prefixToShow.replace("prefix", prefixData.prefix_value);
  prefixToShow = prefixToShow.replace("suffix", prefixData.suffix_value);
  prefixToShow = prefixToShow.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0")
  );
  prefixToShow = prefixToShow.replace(
    "day",
    String(now.getDate()).padStart(2, "0")
  );
  prefixToShow = prefixToShow.replace("year", now.getFullYear());
  prefixToShow = prefixToShow.replace(
    "running_number",
    String(prefixData.running_number).padStart(prefixData.padding_zeroes, "0")
  );

  return prefixToShow;
};

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("goods_delivery")
    .where({ delivery_no: generatedPrefix })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (prefixData) => {
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix({
      ...prefixData,
      running_number: runningNumber,
    });
    isUnique = await checkUniqueness(prefixToShow);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Goods Delivery number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const getPrefixData = async () => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Delivery",
      is_deleted: 0,
    })
    .get();

  if (!prefixEntry.data || prefixEntry.data.length === 0) {
    return null;
  }

  return prefixEntry.data[0];
};

const setPrefix = async () => {
  const prefixData = await getPrefixData();

  if (prefixData && prefixData.is_active === 1) {
    const { prefixToShow } = await findUniquePrefix(prefixData);
    this.setData({ delivery_no: prefixToShow });
    this.disabled(["delivery_no"], true);
  }
};

const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    default:
      break;
  }
};

const disableTableRows = () => {
  setTimeout(() => {
    const data = this.getValues();
    const rows = data.table_gd || [];

    rows.forEach((row, index) => {
      const fieldNames = Object.keys(row).filter(
        (key) => key !== "gd_delivery_qty"
      );

      const fieldsToDisable = fieldNames.map(
        (field) => `table_gd.${index}.${field}`
      );

      this.disabled(fieldsToDisable, true);
    });
  }, 1000);
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";

    const data = this.getValues();

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    this.setData({ page_status: pageStatus });

    const salesOrderId = this.getValue("so_id");
    if (salesOrderId) {
      this.setData({ so_id: undefined });
      this.setData({ so_id: salesOrderId });
    }

    if (pageStatus !== "Add") {
      // Handle Edit/View/Clone modes
      const goodsDeliveryId = data.id;
      const resGD = await db
        .collection("goods_delivery")
        .where({ id: goodsDeliveryId })
        .get();

      if (resGD.data && resGD.data.length > 0) {
        const goodsDelivery = resGD.data[0];

        // Extract all fields
        const {
          gd_status,
          so_id,
          so_no,
          gd_billing_name,
          gd_billing_cp,
          delivery_no,
          gd_ref_doc,
          plant_id,
          organization_id,
          customer_name,
          gd_contact_name,
          contact_number,
          email_address,
          document_description,
          gd_delivery_method,
          delivery_date,
          driver_name,
          driver_contact_no,
          validity_of_collection,
          vehicle_no,
          pickup_date,
          courier_company,
          shipping_date,
          freight_charges,
          tracking_number,
          est_arrival_date,
          driver_cost,
          est_delivery_date,
          shipping_company,
          shipping_method,
          table_gd,
          order_remark,
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
        } = goodsDelivery;

        // Set data to form
        const gd = {
          gd_status,
          so_id,
          so_no,
          gd_billing_name,
          gd_billing_cp,
          delivery_no,
          gd_ref_doc,
          plant_id,
          organization_id,
          customer_name,
          gd_contact_name,
          contact_number,
          email_address,
          document_description,
          gd_delivery_method,
          delivery_date,
          driver_name,
          driver_contact_no,
          validity_of_collection,
          vehicle_no,
          pickup_date,
          courier_company,
          shipping_date,
          freight_charges,
          tracking_number,
          est_arrival_date,
          driver_cost,
          est_delivery_date,
          shipping_company,
          shipping_method,
          table_gd,
          order_remark,
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
        };

        await this.setData(gd);

        // Show status
        showStatusHTML(gd_status);

        // Handle View mode
        if (pageStatus === "View") {
          this.disabled(
            [
              "gd_status",
              "so_id",
              "so_no",
              "gd_billing_name",
              "gd_billing_cp",
              "gd_billing_address",
              "gd_shipping_address",
              "delivery_no",
              "gd_ref_doc",
              "customer_name",
              "gd_contact_name",
              "contact_number",
              "email_address",
              "document_description",
              "plant_id",
              "organization_id",
              "gd_delivery_method",
              "delivery_date",
              "driver_name",
              "driver_contact_no",
              "validity_of_collection",
              "vehicle_no",
              "pickup_date",
              "courier_company",
              "shipping_date",
              "freight_charges",
              "tracking_number",
              "est_arrival_date",
              "driver_cost",
              "est_delivery_date",
              "shipping_company",
              "shipping_method",
              "order_remark",
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
              "gd_item_balance.table_item_balance",
            ],
            true
          );

          // Disable table rows
          disableTableRows();

          // Hide buttons and links
          this.hide([
            "link_billing_address",
            "link_shipping_address",
            "button_save_as_draft",
            "button_save_as_completed",
            "button_save_as_created",
            "so_id",
          ]);

          this.display(["so_no"]);
        }
      }
    } else {
      // Add mode
      this.display(["draft_status"]);
      this.reset();

      // Set prefix for new document
      await setPrefix();
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
