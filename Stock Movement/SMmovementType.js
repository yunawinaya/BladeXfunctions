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
      "stock_movement.batch_id",
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

const generatePrefix = (runNumber, prefixData, now) => {
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
    .collection("stock_movement")
    .where({
      stock_movement_no: generatedPrefix,
      organization_id: organizationId,
      is_deleted: 0,
    })
    .get();
  return !existingDoc.data[0];
};

const findUniquePrefix = async (
  prefixData,
  now,
  organizationId,
  maxAttempts = 10
) => {
  let runningNumber = prefixData.running_number;
  let attempts = 0;
  let isUnique = false;
  let prefixToShow;

  while (!isUnique && attempts < maxAttempts) {
    prefixToShow = generatePrefix(runningNumber, prefixData, now);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) runningNumber++;
    attempts++;
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Stock Movement number after maximum attempts"
    );
  }
  return prefixToShow;
};

const initPrefix = async (movementType) => {
  const organizationId = this.getValue("organization_id");

  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Stock Movement",
      movement_type: movementType,
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();

  const prefixData = prefixEntry.data[0];
  this.disabled(["stock_movement_no"], prefixData.is_active !== 0);

  const uniquePrefix = await findUniquePrefix(
    prefixData,
    new Date(),
    organizationId
  );

  await this.setData({ stock_movement_no: uniquePrefix });
};

const init = async (movementType, pageStatus) => {
  const initialData = {
    movement_reason: "",
    delivery_method: "",
    stock_movement_no: "",
    sm_item_balance: [],
    table_item_balance: [],
    stock_movement: [],
    balance_index: [],
  };

  await this.setData(initialData);
  this.disabled(["stock_movement", "movement_reason"], !movementType);

  if (pageStatus !== "View") {
    await initPrefix(movementType);
  }
};

const checkIntegrationType = () => {
  const integrationType = this.getValue("acc_integration_type");
  if (integrationType === "No Accounting Integration") {
    this.hide(["button_post", "comp_post_button"]);
  }
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

(async () => {
  const data = this.getValues();
  const {
    movement_type: movementType = "",
    page_status: pageStatus,
    balance_index: balanceIndex = [],
  } = data;

  if (pageStatus === "Add") {
    if (arguments[0]?.value) {
      await init(movementType, pageStatus);
      this.triggerEvent("onChange_delivery_method");
    } else {
      await this.setData({
        movement_reason: "",
        delivery_method: "",
        stock_movement_no: "",
        issuing_operation_faci: "",
        sm_item_balance: [],
        table_item_balance: [],
        stock_movement: [],
        balance_index: [],
      });
      this.hide([
        "is_production_order",
        "delivery_method",
        "receiving_operation_faci",
      ]);
      this.triggerEvent("func_reset_delivery_method");
    }
  }

  if (movementType) {
    await configureFields(movementType, this.getValue("is_production_order"));
    await configureButtons(
      movementType,
      pageStatus,
      data.stock_movement_status
    );

    const resType = await db
      .collection("blade_dict")
      .where({ dict_key: movementType })
      .get();
    const movementTypeId = resType.data[0]?.id;

    if (movementTypeId) {
      const resReason = await db
        .collection("blade_dict")
        .where({ parent_id: movementTypeId })
        .get();
      await this.setOptionData("movement_reason", resReason.data);
    }

    await checkIntegrationType();
  }

  this.hide(CONFIG.hideFields[pageStatus]);

  if (pageStatus !== "Add" && movementType && balanceIndex.length > 0) {
    setTimeout(() => {
      this.setData({ balance_index: balanceIndex });
    }, 2000);
  }
})();
