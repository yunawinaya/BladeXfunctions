const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Issued":
      this.display(["issued_status"]);
      break;
    case "In Progress":
      this.display(["processing_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Fully Posted":
      this.display(["fullyposted_status"]);
      break;
    case "Cancelled":
      this.display(["cancel_status"]);
      break;
    default:
      break;
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
      if (aiData.acc_integration_type === "No Accounting Integration") {
        this.hide(["button_post", "comp_post_button"]);
      }
    }
  }
};

const filterMovementType = async () => {
  const resDict = await db
    .collection("blade_dict")
    .where({ dict_value: "Stock Movement Type" })
    .get();

  if (resDict && resDict.data.length > 0) {
    const stockMovementId = resDict.data[0].id;

    const resMovementType = await db
      .collection("blade_dict")
      .where({ parent_id: stockMovementId })
      .get();

    if (resMovementType && resMovementType.data.length > 0) {
      const allMovementTypes = await resMovementType.data;
      const restrictedTypes = [
        "Good Issue",
        "Production Receipt",
        "Inter Operation Facility Transfer (Receiving)",
      ];

      const filteredTypes = allMovementTypes.filter(
        (type) => !restrictedTypes.includes(type.dict_value)
      );

      this.setOptionData(["movement_type"], filteredTypes);
    } else {
      console.error("No movement types found in database");
      return;
    }
  } else {
    console.error("No movement types found in database");
    return;
  }
};

const displayDeliveryField = async () => {
  const deliveryMethodName = this.getValue("delivery_method");

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

const filterIOFTReceivingCategory = async () => {
  const data = this.getValues();
  const stockMovement = data.stock_movement;

  const categoryObjectResponse = await db
    .collection("blade_dict")
    .where({ code: "inventory_category" })
    .get();

  const allowedCategories = ["Unrestricted", "Quality Inspection", "Blocked"];

  const filteredCategories = categoryObjectResponse.data.filter((category) =>
    allowedCategories.includes(category.dict_key)
  );

  // Set category options
  for (const [rowIndex, sm] of stockMovement.entries()) {
    await this.setOptionData(
      [`stock_movement.${rowIndex}.category`],
      filteredCategories
    );
  }
};

const showProductionOrder = (data) => {
  if (data.is_production_order === 1) {
    this.display(["production_order_id", "is_production_order"]);
    this.disabled(
      ["stock_movement.item_selection", "stock_movement.location_id"],
      true
    );
  }
};

const checkPrefixConfiguration = async (movementType, organizationId) => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Stock Movement",
        movement_type: movementType,
        is_deleted: 0,
        organization_id: organizationId,
      })
      .get();

    if (prefixEntry.data && prefixEntry.data.length > 0) {
      return prefixEntry.data[0];
    }
    return null;
  } catch (error) {
    console.error("Error checking prefix configuration:", error);
    return null;
  }
};

const editDisabledField = async (data) => {
  this.disabled(
    [
      "issue_date",
      "stock_movement_no",
      "movement_type",
      "movement_reason",
      "issued_by",
      "issuing_operation_faci",
      "remarks",
      "delivery_method",
      "reference_documents",
      "receiving_operation_faci",
      "movement_id",
      "is_production_order",
      "production_order_id",

      "cp_driver_name",
      "cp_ic_no",
      "cp_driver_contact_no",
      "cp_vehicle_number",
      "cp_pickup_date",
      "cp_validity_collection",

      "cs_courier_company",
      "cs_shipping_date",
      "cs_tracking_number",
      "cs_est_arrival_date",
      "cs_freight_charges",

      "ct_driver_name",
      "ct_driver_contact_no",
      "ct_ic_no",
      "ct_vehicle_number",
      "ct_est_delivery_date",
      "ct_delivery_cost",

      "ss_shipping_company",
      "ss_shipping_date",
      "ss_freight_charges",
      "ss_shipping_method",
      "ss_est_arrival_date",
      "ss_tracking_number",

      "tpt_vehicle_number",
      "tpt_transport_name",
      "tpt_ic_no",
      "tpt_driver_contact_no",

      "stock_movement",
      "stock_movement.item_selection",
      "stock_movement.total_quantity",
      "stock_movement.category",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.batch_id",
    ],
    true
  );

  // Hide edit button
  setTimeout(() => {
    const editButton = document.querySelector(
      ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--small.is-link"
    );
    if (editButton) {
      editButton.style.display = "none";
    }
  }, 500);

  this.hide(["stock_movement.transfer_stock", "stock_movement.edit_stock"]);

  if (
    data.movement_type === "Miscellaneous Issue" ||
    data.movement_type === "Miscellaneous Receipt" ||
    data.movement_type === "Disposal/Scrap"
  ) {
    this.display("button_post");
  }
};

const filterInvCategory = async (movementType, stockMovement) => {
  const movementTypeCategories = {
    "Inter Operation Facility Transfer": ["Unrestricted", "Blocked"],
    "Inter Operation Facility Transfer (Receiving)": [
      "Unrestricted",
      "Quality Inspection",
      "Blocked",
    ],
    "Location Transfer": ["Unrestricted", "Blocked"],
    "Miscellaneous Issue": ["Unrestricted"],
    "Miscellaneous Receipt": ["Unrestricted", "Blocked"],
    "Disposal/Scrap": ["Unrestricted", "Blocked"],
    "Inventory Category Transfer Posting": ["Unrestricted", "Blocked"],
  };

  let filteredCategories;

  const categoryObjectResponse = await db
    .collection("blade_dict")
    .where({ code: "inventory_category" })
    .get();

  setTimeout(async () => {
    const allowedCategories = movementTypeCategories[movementType] || [
      "Unrestricted",
    ];
    filteredCategories = categoryObjectResponse.data.filter((category) =>
      allowedCategories.includes(category.dict_key)
    );

    console.log("filteredCategories", filteredCategories);

    for (const [index, sm] of stockMovement.entries()) {
      await this.setOptionData(
        [`stock_movement.${index}.category`],
        filteredCategories
      );
      this.disabled([`stock_movement.${index}.category`], false);
    }
    // Set category options
  }, 50);
};

(async () => {
  try {
    const data = this.getValues();
    let pageStatus = "";

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        const nickName = await this.getVarGlobal("nickname");
        this.setData({
          organization_id: organizationId,
          issued_by: nickName,
          issue_date: new Date().toISOString().split("T")[0],
        });

        this.disabled(
          ["stock_movement", "movement_type", "movement_reason"],
          true
        );
        this.display(["draft_status", "button_save_as_draft"]);
        this.hide([
          "delivery_method",
          "receiving_operation_faci",
          "stock_movement.view_stock",
          "stock_movement.edit_stock",
        ]);

        await checkAccIntegrationType(organizationId);
        await filterMovementType();
        break;

      case "Edit":
        const prefixConfig = await checkPrefixConfiguration(
          data.movement_type,
          organizationId
        );

        if (prefixConfig && prefixConfig.is_active === 0) {
          this.disabled(["stock_movement_no"], false);
        }

        this.disabled("movement_type", true);
        this.hide([
          "stock_movement.transfer_stock",
          "stock_movement.view_stock",
        ]);

        if (
          data.stock_movement_status === "Created" &&
          data.movement_type === "Inter Operation Facility Transfer (Receiving)"
        ) {
          this.disabled(["stock_movement.received_quantity"], true);
          await filterIOFTReceivingCategory();
        }

        if (
          data.stock_movement_status === "Completed" ||
          data.stock_movement_status === "Fully Posted"
        ) {
          await editDisabledField(data);
        }

        if (
          data.stock_movement_status === "Draft" &&
          data.movement_type == "Miscellaneous Receipt"
        ) {
          await filterInvCategory(data.movement_type, data.stock_movement);
        }

        await filterMovementType();
        await displayDeliveryField();
        await showProductionOrder(data);
        await showStatusHTML(data.stock_movement_status);
        await checkAccIntegrationType(organizationId);

        break;

      case "View":
        this.hide([
          "stock_movement.transfer_stock",
          "stock_movement.view_stock",
          "stock_movement.edit_stock",
        ]);
        await displayDeliveryField();
        await showStatusHTML(data.stock_movement_status);
        await showProductionOrder(data);
        await checkAccIntegrationType(organizationId);

        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
