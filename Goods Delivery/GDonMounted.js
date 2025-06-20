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

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("goods_delivery")
    .where({ delivery_no: generatedPrefix, organization_id: organizationId })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
};

const findUniquePrefix = async (prefixData, organizationId) => {
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
    isUnique = await checkUniqueness(prefixToShow, organizationId);
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

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Goods Delivery",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();

  if (!prefixEntry.data || prefixEntry.data.length === 0) {
    return null;
  } else {
    if (prefixEntry.data[0].is_active === 0) {
      this.disabled(["delivery_no"], false);
    } else {
      this.disabled(["delivery_no"], true);
    }
  }

  return prefixEntry.data[0];
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  if (prefixData && prefixData.is_active === 1) {
    const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);
    this.setData({ delivery_no: prefixToShow });
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
    case "Cancelled":
      this.display(["cancel_status"]);
      break;
    default:
      break;
  }
};

const disabledField = async (status, pickingStatus) => {
  if (
    status === "Completed" ||
    pickingStatus === "Completed" ||
    pickingStatus === "In Progress"
  ) {
    this.disabled(
      [
        "gd_status",
        "so_id",
        "so_no",
        "fake_so_id",
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
      "button_save_as_created",
      "so_id",
      "fake_so_id",
    ]);

    if (status === "Completed") {
      this.hide(["button_save_as_completed"]);
    }

    this.display(["so_no"]);
  } else {
    if (status === "Created") {
      this.hide(["button_save_as_draft"]);
    }
    this.disabled(
      [
        "gd_ref_doc",
        "gd_delivery_method",
        "document_description",
        "order_remark",
      ],
      false
    );
    this.hide(["fake_so_id"]);
    this.display("so_id");
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

const displayDeliveryMethod = async () => {
  const deliveryMethodName = this.getValue("gd_delivery_method");
  console.log("deliveryMethodName", deliveryMethodName);

  if (
    deliveryMethodName &&
    typeof deliveryMethodName === "string" &&
    deliveryMethodName.trim() !== ""
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

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";
  if (deptId === organizationId) {
    const resPlant = await db
      .collection("blade_dept")
      .where({ parent_id: deptId })
      .get();

    if (!resPlant && resPlant.data.length === 0) {
      plantId = deptId;
    } else {
      plantId = "";
    }
  } else {
    plantId = deptId;
  }

  this.setData({
    organization_id: organizationId,
    plant_id: plantId,
    delivery_date: new Date().toISOString().split("T")[0],
  });
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

const disabledSelectStock = async (data) => {
  data.table_gd.forEach(async (item, index) => {
    if (item.material_id && item.material_id !== "") {
      if (item.gd_undelivered_qty <= 0) {
        this.disabled(
          [`table_gd.${index}.gd_qty`, `table_gd.${index}.gd_delivery_qty`],
          true
        );
      } else {
        const resItem = await db
          .collection("item")
          .where({ id: item.material_id, is_deleted: 0 })
          .get();
        if (resItem && resItem.data.length > 0) {
          const plant = data.plant_id;
          const itemData = resItem.data[0];

          if (itemData.item_batch_management === 0) {
            if (plant) {
              const resItemBalance = await db
                .collection("item_balance")
                .where({
                  plant_id: plant,
                  material_id: item.material_id,
                  is_deleted: 0,
                })
                .get();

              if (resItemBalance && resItemBalance.data.length === 1) {
                this.disabled([`table_gd.${index}.gd_delivery_qty`], true);
                this.disabled([`table_gd.${index}.gd_qty`], false);
              }
            }
          } else {
            console.error("Item batch management is not found.");
          }
        }
      }
    }
  });
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";
    const status = await this.getValue("gd_status");
    const pickingStatus = await this.getValue("picking_status");
    const data = this.getValues();

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });

    const salesOrderId = this.getValue("so_id");

    switch (pageStatus) {
      case "Add":
        // Add mode
        this.display(["draft_status"]);

        await checkAccIntegrationType(organizationId);
        await setPlant(organizationId);
        // Set prefix for new document
        await setPrefix(organizationId);
        break;

      case "Edit":
        if (status !== "Completed") {
          await getPrefixData(organizationId);
        }
        await checkAccIntegrationType(organizationId);
        await disabledField(status, pickingStatus);
        await disabledSelectStock(data);
        await showStatusHTML(status);
        if (salesOrderId.length > 0) {
          await this.display(["address_grid"]);
        }
        await displayDeliveryMethod();
        break;

      case "View":
        await showStatusHTML(status);
        await displayDeliveryMethod();
        this.hide([
          "link_billing_address",
          "link_shipping_address",
          "button_save_as_draft",
          "button_save_as_completed",
          "button_save_as_created",
          "so_id",
          "fake_so_id",
          "table_gd.gd_delivery_qty",
        ]);

        if (salesOrderId.length > 0) {
          await this.display(["address_grid"]);
        }

        this.display(["so_no"]);
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
