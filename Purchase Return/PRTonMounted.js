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
    .collection("purchase_return_head")
    .where({
      purchase_return_no: generatedPrefix,
      organization_id: organizationId,
    })
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
    prefixToShow = await generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Purchase Return number after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);

  this.setData({
    purchase_return_no: prefixToShow,
    return_by: this.getVarGlobal("nickname"),
  });
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Purchase Returns",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();
  const prefixData = await prefixEntry.data[0];

  if (prefixData.is_active === 0) {
    this.disabled(["purchase_return_no"], false);
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
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
  }
};

const displayDeliveryMethod = async () => {
  const deliveryMethod = this.getValue("return_delivery_method");

  if (Object.keys(deliveryMethod).length > 0) {
    this.setData({ delivery_method_text: deliveryMethod });

    const visibilityMap = {
      "Self Pickup": "self_pickup",
      "Courier Service": "courier_service",
      "Company Truck": "company_truck",
      "Shipping Service": "shipping_service",
      "3rd Party Transporter": "third_party_transporter",
    };

    const selectedField = visibilityMap[deliveryMethod] || null;
    const fields = [
      "self_pickup",
      "courier_service",
      "company_truck",
      "shipping_service",
      "third_party_transporter",
    ];

    if (!selectedField) {
      this.hide(fields);
    }
    fields.forEach((field) => {
      field === selectedField ? this.display(field) : this.hide(field);
    });
  } else {
    this.setData({ delivery_method_text: "" });
  }
};

const displayAddress = async () => {
  const purchaseOrderId = this.getValue("purchase_order_id");

  if (purchaseOrderId) {
    this.display("address_grid");
  }
};

const disabledField = async (status) => {
  if (status !== "Draft") {
    this.disabled(
      [
        "purchase_return_status",
        "purchase_return_no",
        "fake_purchase_order_id",
        "purchase_order_id",
        "goods_receiving_id",
        "organization_id",
        "supplier_id",
        "prt_billing_name",
        "prt_billing_cp",
        "prt_billing_address",
        "prt_shipping_address",
        "gr_date",
        "plant",
        "purchase_return_date",
        "input_hvxpruem",
        "return_delivery_method",
        "purchase_return_ref",
        "shipping_details",
        "reason_for_return",
        "driver_name",
        "vehicle_no",
        "driver_contact",
        "pickup_date",
        "courier_company",
        "shipping_date",
        "estimated_arrival",
        "shipping_method",
        "freight_charge",
        "driver_name2",
        "driver_contact_no2",
        "estimated_arrival2",
        "vehicle_no2",
        "delivery_cost",
        "table_prt",
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
      ],
      true
    );

    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_issue",
      "fake_purchase_order_id",
      "purchase_order_id",
    ]);

    this.display("po_no_display");
  }
};

(async () => {
  try {
    const status = await this.getValue("purchase_return_status");

    const pageStatus = this.isAdd
      ? "Add"
      : this.isEdit
      ? "Edit"
      : this.isView
      ? "View"
      : this.isCopy
      ? "Clone"
      : (() => {
          this.$message.error("Invalid page status");
        })();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds");
    }

    this.setData({ organization_id: organizationId, page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        await setPrefix(organizationId);
        break;

      case "Edit":
        await getPrefixData(organizationId);
        await disabledField(status);
        if (status === "Draft") {
          this.hide(["fake_purchase_order_id"]);
          this.display("purchase_order_id");
        } else {
          this.display("po_no_display");
        }

        await showStatusHTML(status);
        await displayDeliveryMethod();
        await displayAddress();
        break;

      case "View":
        this.hide([
          "link_billing_address",
          "link_shipping_address",
          "button_save_as_draft",
          "button_save_as_issue",
          "fake_purchase_order_id",
          "purchase_order_id",
          "table_prt.select_return_qty",
        ]);

        if (status !== "Draft") {
          this.display("po_no_display");
        }
        await showStatusHTML(status);
        await displayDeliveryMethod();
        await displayAddress();

        break;
    }
  } catch (error) {
    this.$message.error(error);
  }
})();
