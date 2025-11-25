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

const CONFIG = {
  fields: {
    all: [
      "stock_movement.item_selection",
      "stock_movement.view_stock",
      "stock_movement.transfer_stock",
      "stock_movement.edit_stock",
      "stock_movement.total_quantity",
      "stock_movement.to_recv_qty",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "stock_movement.batch_id",
      "stock_movement.category",
      "stock_movement.stock_summary",
      "movement_reason",
      "delivery_method",
      "receiving_operation_faci",
      "is_production_order",
    ],
    buttons: [
      "button_post",
      "comp_post_button",
      "button_inprogress_ift",
      "button_complete_receive",
      "button_save_as_draft",
      "button_issued_ift",
      "button_completed",
    ],
  },
  hideFields: {
    Add: ["stock_movement.edit_stock", "stock_movement.view_stock"],
    View: ["stock_movement.transfer_stock", "stock_movement.edit_stock"],
    Edit: ["stock_movement.view_stock", "stock_movement.transfer_stock"],
    "Inter Operation Facility Transfer": [
      "stock_movement.received_quantity",
      "stock_movement.category",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "is_production_order",
      "stock_movement.to_recv_qty",
      "stock_movement.batch_id",
    ],
    "Location Transfer": [
      "delivery_method",
      "receiving_operation_faci",
      "stock_movement.category",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.to_recv_qty",
      "stock_movement.batch_id",
    ],
    "Miscellaneous Issue": [
      "receiving_operation_faci",
      "delivery_method",
      "stock_movement.category",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "is_production_order",
      "stock_movement.to_recv_qty",
      "stock_movement.batch_id",
    ],
    "Miscellaneous Receipt": [
      "delivery_method",
      "receiving_operation_faci",
      "stock_movement.transfer_stock",
      "stock_movement.total_quantity",
      "stock_movement.quantity_uom",
      "is_production_order",
      "stock_movement.to_recv_qty",
      "stock_movement.view_stock",
      "stock_movement.edit_stock",
      "stock_movement.stock_summary",
    ],
    "Disposal/Scrap": [
      "receiving_operation_faci",
      "delivery_method",
      "stock_movement.category",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "is_production_order",
      "stock_movement.to_recv_qty",
      "stock_movement.batch_id",
    ],
    "Inventory Category Transfer Posting": [
      "receiving_operation_faci",
      "delivery_method",
      "movement_reason",
      "stock_movement.category",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "is_production_order",
      "stock_movement.to_recv_qty",
      "stock_movement.batch_id",
    ],
    "Inter Operation Facility Transfer (Receiving)": [
      "stock_movement.transfer_stock",
      "stock_movement.amount",
      "stock_movement.quantity_uom",
      "is_production_order",
      "delivery_method",
      "receiving_operation_faci",
      "stock_movement.view_stock",
      "stock_movement.edit_stock",
      "stock_movement.stock_summary",
    ],
    "Good Issue": [
      "receiving_operation_faci",
      "delivery_method",
      "stock_movement.category",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "stock_movement.to_recv_qty",
      "stock_movement.batch_id",
    ],
    "Production Receipt": [
      "delivery_method",
      "receiving_operation_faci",
      "stock_movement.quantity_uom",
      "stock_movement.transfer_stock",
      "stock_movement.total_quantity",
      "stock_movement.to_recv_qty",
      "stock_movement.view_stock",
      "stock_movement.edit_stock",
      "stock_movement.stock_summary",
    ],
  },
  buttonConfig: {
    Add: {
      "Inter Operation Facility Transfer (Receiving)": [
        "button_save_as_draft",
        "button_complete_receive",
      ],
      "Inter Operation Facility Transfer": [
        "button_issued_ift",
        "button_save_as_draft",
      ],
      "Location Transfer": ["button_save_as_draft", "button_completed"],
      "Inventory Category Transfer Posting": [
        "button_save_as_draft",
        "button_completed",
      ],
      "Miscellaneous Issue": [
        "button_save_as_draft",
        "button_completed",
        "comp_post_button",
      ],
      "Good Issue": [
        "button_save_as_draft",
        "button_completed",
        "comp_post_button",
      ],
      "Miscellaneous Receipt": [
        "button_save_as_draft",
        "button_completed",
        "comp_post_button",
      ],
      "Production Receipt": [
        "button_save_as_draft",
        "button_completed",
        "comp_post_button",
      ],
      "Disposal/Scrap": [
        "button_save_as_draft",
        "button_completed",
        "comp_post_button",
      ],
    },
    Edit: {
      Issued: {
        "Inter Operation Facility Transfer": ["button_inprogress_ift"],
      },
      Completed: {
        default: ["button_post"],
      },
      Created: {
        "Inter Operation Facility Transfer (Receiving)": [
          "button_complete_receive",
        ],
        "Location Transfer": ["button_completed"],
      },
    },
  },
};

const configureFields = (movementType, isProductionOrder) => {
  this.display(CONFIG.fields.all);
  if (CONFIG.hideFields[movementType]) {
    this.hide(CONFIG.hideFields[movementType]);
  }

  if (movementType === "Location Transfer" && isProductionOrder) {
    this.display(["stock_movement.requested_qty"]);
  }

  if (movementType === "Inter Operation Facility Transfer (Receiving)") {
    this.disabled(["stock_movement.received_quantity_uom"], true);
    this.disabled(["stock_movement.category"], false);
  }

  const disableFields = [
    "Location Transfer",
    "Miscellaneous Issue",
    "Disposal/Scrap",
  ];
  if (disableFields.includes(movementType)) {
    this.disabled(["stock_movement.total_quantity"], true);
  }
};

const configureButtons = (movementType, pageStatus, stockMovementStatus) => {
  this.hide(CONFIG.fields.buttons);

  if (
    pageStatus === "Add" ||
    (stockMovementStatus === "Draft" && pageStatus === "Edit")
  ) {
    this.display(
      CONFIG.buttonConfig.Add[movementType] || [
        "button_save_as_draft",
        "button_completed",
        "comp_post_button",
      ]
    );
  } else if (
    pageStatus === "Edit" &&
    CONFIG.buttonConfig.Edit[stockMovementStatus]?.[movementType]
  ) {
    this.display(CONFIG.buttonConfig.Edit[stockMovementStatus][movementType]);
  } else if (
    pageStatus === "Edit" &&
    stockMovementStatus === "Completed" &&
    [
      "Inter Operation Facility Transfer",
      "Miscellaneous Issue",
      "Good Issue",
      "Miscellaneous Receipt",
      "Production Receipt",
      "Disposal/Scrap",
      "Inter Operation Facility Transfer (Receiving)",
    ].includes(movementType)
  ) {
    this.display(CONFIG.buttonConfig.Edit.Completed.default);
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
  for (const [rowIndex, _sm] of stockMovement.entries()) {
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
      [
        "stock_movement.item_selection",
        "stock_movement.location_id",
        "stock_movement.storage_location_id",
      ],
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
      "remark",
      "remark2",
      "remark3",
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
      "stock_movement.storage_location_id",
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

    for (const [index, _sm] of stockMovement.entries()) {
      await this.setOptionData(
        [`stock_movement.${index}.category`],
        filteredCategories
      );
      this.disabled([`stock_movement.${index}.category`], false);
    }
    // Set category options
  }, 50);
};

const viewSerialNumber = async () => {
  const tableSM = this.getValue("stock_movement");
  tableSM.forEach((sm, index) => {
    if (sm.is_serialized_item === 1) {
      this.display(`stock_movement.select_serial_number`);
      this.disabled(`stock_movement.${index}.received_quantity`, true);
    } else {
      this.disabled(`stock_movement.${index}.received_quantity`, false);
    }
  });
};

const hideSerialNumberRecordTab = () => {
  setTimeout(() => {
    const tableSerialNumber = this.getValue("table_sn_records");
    if (!tableSerialNumber || tableSerialNumber.length === 0) {
      const tabSelector =
        '.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-serial_number_records[tabindex="-1"][aria-selected="false"]';
      const tab = document.querySelector(tabSelector);

      if (tab) {
        tab.style.display = "none";
      } else {
        const fallbackTab = document.querySelector(
          '.el-drawer[role="dialog"] .el-tabs__item#tab-serial_number_records'
        );
        if (fallbackTab) {
          fallbackTab.style.display = "none";
        } else {
          console.log("Completion tab not found");
        }
      }

      const inactiveTabSelector =
        '.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-serial_number_records)';
      const inactiveTab = document.querySelector(inactiveTabSelector);
      if (inactiveTab) {
        inactiveTab.setAttribute("aria-disabled", "true");
        inactiveTab.classList.add("is-disabled");
      }
    }
  }, 10); // Small delay to ensure DOM is ready
};

const displayManufacturingAndExpiredDate = async (
  status,
  pageStatus,
  movementType
) => {
  const tableSM = this.getValue("stock_movement");
  if (movementType === "Miscellaneous Receipt") {
    if (pageStatus === "Edit") {
      if (status === "Draft") {
        for (const [index, item] of tableSM.entries()) {
          if (item.batch_id !== "-") {
            await this.display([
              "stock_movement.manufacturing_date",
              "stock_movement.expired_date",
            ]);
            await this.disabled(
              [
                `stock_movement.${index}.manufacturing_date`,
                `stock_movement.${index}.expired_date`,
              ],
              false
            );
          } else {
            await this.disabled(
              [
                `stock_movement.${index}.manufacturing_date`,
                `stock_movement.${index}.expired_date`,
              ],
              true
            );
          }
        }
      } else {
        for (const [_index, item] of tableSM.entries()) {
          if (item.batch_id !== "-") {
            await this.display([
              "stock_movement.manufacturing_date",
              "stock_movement.expired_date",
            ]);
          }
        }
      }
    } else {
      for (const [_index, item] of tableSM.entries()) {
        if (item.item_batch_no !== "-") {
          await this.display([
            "stock_movement.manufacturing_date",
            "stock_movement.expired_date",
          ]);
        }
      }
    }
  }
};

const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];

  if (currentDept === organizationId) {
    this.disabled("issuing_operation_faci", false);
  } else {
    this.disabled("issuing_operation_faci", true);
  }

  if (pageStatus === "Add" && currentDept !== organizationId) {
    this.setData({ issuing_operation_faci: currentDept });
  }
};

const setStorageLocation = async () => {
  try {
    const smTable = this.getValue("stock_movement");

    if (smTable.length > 0) {
      for (const [index, item] of smTable.entries()) {
        console.log("location_id", item.location_id);
        console.log("storage_location_id", item.storage_location_id);
        if (!item.storage_location_id && item.location_id) {
          this.setData({
            [`stock_movement.${index}.storage_location_id`]: "",
            [`stock_movement.${index}.location_id`]: "",
          });
          const binLocationData = await db
            .collection("bin_location")
            .where({ id: item.location_id })
            .get()
            .then((res) => res.data[0]);

          this.setData({
            [`stock_movement.${index}.storage_location_id`]:
              binLocationData.storage_location_id,
          });
        }
      }
    }
  } catch (error) {
    console.log(error);
  }
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
        await setPlant(organizationId, pageStatus);
        await checkAccIntegrationType(organizationId);
        await filterMovementType();
        await hideSerialNumberRecordTab();
        await setStorageLocation();
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
          await viewSerialNumber();
        }

        await configureFields(data.movement_type, data.is_production_order);
        await configureButtons(
          data.movement_type,
          pageStatus,
          data.stock_movement_status
        );

        this.hide(CONFIG.hideFields[pageStatus]);
        if (data.stock_movement_status === "Draft") {
          await setPlant(organizationId, pageStatus);
        }
        await filterMovementType();
        await displayDeliveryField();
        await showProductionOrder(data);
        await showStatusHTML(data.stock_movement_status);
        await checkAccIntegrationType(organizationId);
        await hideSerialNumberRecordTab();
        await displayManufacturingAndExpiredDate(
          data.stock_movement_status,
          pageStatus,
          data.movement_type
        );
        await setStorageLocation();

        break;

      case "View":
        await configureFields(data.movement_type, data.is_production_order);
        await configureButtons(
          data.movement_type,
          pageStatus,
          data.stock_movement_status
        );
        this.hide([
          "stock_movement.transfer_stock",
          "stock_movement.view_stock",
          "stock_movement.edit_stock",
        ]);

        await displayDeliveryField();
        await showStatusHTML(data.stock_movement_status);
        await showProductionOrder(data);
        await checkAccIntegrationType(organizationId);
        await hideSerialNumberRecordTab();
        await displayManufacturingAndExpiredDate(
          data.stock_movement_status,
          pageStatus,
          data.movement_type
        );
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
