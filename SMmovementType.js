const movementTypeOptions = [
  "Inter Operation Facility Transfer (Receiving)",
  "Inventory Category Transfer Posting",
  "Disposal/Scrap",
  "Miscellaneous Receipt",
  "Miscellaneous Issue",
  "Location Transfer",
  "Inter Operation Facility Transfer",
];

const currentValues = this.getValues();
console.log("currentValues", currentValues);
const savedBalanceIndex = currentValues.balance_index || [];
console.log("savedBalanceIndex", savedBalanceIndex);
const originalMovementType = currentValues.movement_type;
console.log("originalMovementType", originalMovementType);

const enhanceStockMovementUI = async () => {
  try {
    // Get page and form data
    const pageAction = this.getParamsVariables("page_status"); // Add, Edit, View
    const { movement_type: movementTypeId, stock_movement_status: pageStatus } =
      this.getValues();

    // Validate page action
    if (!["Add", "Edit", "View", undefined].includes(pageAction)) {
      console.warn(`Invalid page action: ${pageAction}`);
    }

    this.setData({
      // 'movement_reason': '',
      // 'issued_by': '',
      // 'tenant_id': '',
      // 'issuing_operation_faci': '',
      // 'receiving_operation_faci': '',
      // 'reference_documents': '',
      sm_item_balance: [],
      table_item_balance: [],
      stock_movement: [],
      // 'remarks': '',
      // 'delivery_method': '',
      // 'driver_name': '',
      // 'vehicle_no': '',
      // 'pickup_date': '',
      // 'courier_company': '',
      // 'tracking_number': '',
      // 'freight_charges': '',
      // 'driver_contact_no': '',
      // 'delivery_cost': '',
      // 'est_delivery_date': '',
      // 'shipping_company': '',
      // 'date_qn0dl3t6': '',
      // 'input_77h4nsq8': '',
      // 'shipping_method': '',
      // 'est_arrival_date': '',
      // 'tracking_no': '',
      balance_index: [],
    });

    // Fetch stock movement type from database
    const { data: movementTypes } = await db
      .collection("stock_movement_type")
      .get();
    if (!movementTypes?.length) {
      throw new Error("No stock movement types found in database");
    }

    const {
      data: [movementTypeEntry],
    } = await db
      .collection("stock_movement_type")
      .where({ id: movementTypeId })
      .get();
    if (!movementTypeEntry) {
      throw new Error("Invalid movement type ID");
    }
    const movementTypeName = movementTypeEntry.sm_type_name;

    // Create mapping of stock movement types to IDs
    const stockMovementMap = Object.fromEntries(
      movementTypes.map((item) => [item.sm_type_name, item.id])
    );

    // Helper functions for button visibility
    const hideAllButtons = () => {
      [
        "button_post",
        "comp_post_button",
        "button_inprogress_ift",
        "button_complete_receive",
        "button_save_as_draft",
        "button_issued_ift",
        "button_completed",
      ].forEach((button) => this.hide(button));
    };

    const showButton = (buttonId) => {
      this.display(buttonId);
    };

    // UI conditions for fields (hide/disable)
    const uiConditions = [
      {
        name: "Inter Operation Facility Transfer",
        hideFields: [
          "stock_movement.received_quantity",
          "stock_movement.recv_location_id",
          "stock_movement.category",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "stock_movement.uom_id",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ],
        disableFields: {
          Add: [],
          Edit: [],
          View: [
            "stock_movement.item_selection",
            "stock_movement.total_quantity",
            "stock_movement.category",
            "stock_movement.received_quantity",
            "stock_movement.received_quantity_uom",
            "stock_movement.unit_price",
            "stock_movement.amount",
            "stock_movement.location_id",
            "movement_reason",
            "stock_movement",
          ],
        },
        pageSpecificFields: {
          Add: {
            show: ["stock_movement.transfer_stock"],
            hide: ["stock_movement.edit_stock", "stock_movement.view_stock"],
          },
          Edit: {
            show: ["stock_movement.edit_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.view_stock",
            ],
          },
          View: {
            show: ["stock_movement.view_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
            ],
          },
        },
      },
      {
        name: "Inter Operation Facility Transfer (Receiving)",
        hideFields: [
          "stock_movement.transfer_stock",
          "stock_movement.amount",
          "is_production_order",
          "delivery_method",
          "receiving_operation_faci",
          "stock_movement.batch_id",
        ],
        disableFields: {
          Add: [
            "stock_movement.item_selection",
            "stock_movement.total_quantity",
            "movement_reason",
          ],
          Edit: [
            "stock_movement.item_selection",
            "stock_movement.total_quantity",
            "movement_reason",
          ],
          View: [
            "stock_movement.item_selection",
            "stock_movement.total_quantity",
            "stock_movement.category",
            "stock_movement.received_quantity",
            "stock_movement.received_quantity_uom",
            "stock_movement.unit_price",
            "stock_movement.amount",
            "stock_movement.location_id",
            "movement_reason",
            "stock_movement",
          ],
        },
        pageSpecificFields: {
          Add: {
            show: [],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
              "stock_movement.view_stock",
            ],
          },
          Edit: {
            show: [],
            hide: [
              "stock_movement.edit_stock",
              "stock_movement.transfer_stock",
              "stock_movement.view_stock",
            ],
          },
          View: {
            show: [],
            hide: [
              "stock_movement.view_stock",
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
            ],
          },
        },
      },
      {
        name: "Location Transfer",
        hideFields: [
          "delivery_method",
          "receiving_operation_faci",
          "stock_movement.recv_location_id",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.uom_id",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ],
        disableFields: {
          Add: [],
          Edit: ["stock_movement.total_quantity"],
          View: [
            "stock_movement.item_selection",
            "stock_movement.category",
            "stock_movement.received_quantity",
            "stock_movement.received_quantity_uom",
            "stock_movement.unit_price",
            "stock_movement.amount",
            "stock_movement.location_id",
            "movement_reason",
          ],
        },
        pageSpecificFields: {
          Add: {
            show: ["stock_movement.transfer_stock"],
            hide: ["stock_movement.edit_stock", "stock_movement.view_stock"],
          },
          Edit: {
            show: ["stock_movement.edit_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.view_stock",
            ],
          },
          View: {
            show: ["stock_movement.view_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
            ],
          },
        },
      },
      {
        name: "Miscellaneous Receipt",
        hideFields: [
          "delivery_method",
          "receiving_operation_faci",
          "stock_movement.recv_location_id",
          "stock_movement.transfer_stock",
          "stock_movement.total_quantity",
          "is_production_order",
          "stock_movement.to_recv_qty",
        ],
        disableFields: {
          Add: ["stock_movement.amount"],
          Edit: [],
          View: [
            "stock_movement.item_selection",
            "stock_movement.total_quantity",
            "stock_movement.category",
            "stock_movement.received_quantity",
            "stock_movement.unit_price",
            "stock_movement.amount",
            "stock_movement.location_id",
            "movement_reason",
            "stock_movement",
          ],
        },
        pageSpecificFields: {
          Add: {
            show: [],
            hide: [
              "stock_movement.edit_stock",
              "stock_movement.view_stock",
              "stock_movement.transfer_stock",
            ],
          },
          Edit: {
            show: [],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.view_stock",
              "stock_movement.edit_stock",
            ],
          },
          View: {
            show: [],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
              "stock_movement.view_stock",
            ],
          },
        },
      },
      {
        name: "Inventory Category Transfer Posting",
        hideFields: [
          "receiving_operation_faci",
          "delivery_method",
          "movement_reason",
          "stock_movement.category",
          "stock_movement.recv_location_id",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "stock_movement.uom_id",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ],
        disableFields: {
          Add: [],
          Edit: [],
          View: [
            "stock_movement.item_selection",
            "stock_movement.total_quantity",
            "stock_movement.category",
            "stock_movement.received_quantity",
            "stock_movement.received_quantity_uom",
            "stock_movement.unit_price",
            "stock_movement.amount",
            "stock_movement.location_id",
            "movement_reason",
          ],
        },
        pageSpecificFields: {
          Add: {
            show: ["stock_movement.transfer_stock"],
            hide: ["stock_movement.edit_stock", "stock_movement.view_stock"],
          },
          Edit: {
            show: ["stock_movement.edit_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.view_stock",
            ],
          },
          View: {
            show: ["stock_movement.view_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
            ],
          },
        },
      },
      {
        name: "Miscellaneous Issue",
        hideFields: [
          "receiving_operation_faci",
          "delivery_method",
          "stock_movement.category",
          "stock_movement.recv_location_id",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "stock_movement.uom_id",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ],
        disableFields: {
          Add: [],
          Edit: [],
          View: [
            "stock_movement.item_selection",
            "stock_movement.total_quantity",
            "stock_movement.category",
            "stock_movement.received_quantity",
            "stock_movement.received_quantity_uom",
            "stock_movement.unit_price",
            "stock_movement.amount",
            "stock_movement.location_id",
            "movement_reason",
          ],
        },
        pageSpecificFields: {
          Add: {
            show: ["stock_movement.transfer_stock"],
            hide: ["stock_movement.edit_stock", "stock_movement.view_stock"],
          },
          Edit: {
            show: ["stock_movement.edit_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.view_stock",
            ],
          },
          View: {
            show: ["stock_movement.view_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
            ],
          },
        },
      },
      {
        name: "Disposal/Scrap",
        hideFields: [
          "receiving_operation_faci",
          "stock_movement.recv_location_id",
          "delivery_method",
          "stock_movement.category",
          "stock_movement.received_quantity",
          "stock_movement.received_quantity_uom",
          "stock_movement.unit_price",
          "stock_movement.amount",
          "stock_movement.location_id",
          "stock_movement.uom_id",
          "is_production_order",
          "stock_movement.to_recv_qty",
          "stock_movement.batch_id",
        ],
        disableFields: {
          Add: [],
          Edit: [],
          View: [
            "stock_movement.item_selection",
            "stock_movement.total_quantity",
            "stock_movement.category",
            "stock_movement.received_quantity",
            "stock_movement.received_quantity_uom",
            "stock_movement.unit_price",
            "stock_movement.amount",
            "stock_movement.location_id",
            "movement_reason",
          ],
        },
        pageSpecificFields: {
          Add: {
            show: ["stock_movement.transfer_stock"],
            hide: ["stock_movement.edit_stock", "stock_movement.view_stock"],
          },
          Edit: {
            show: ["stock_movement.edit_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.view_stock",
            ],
          },
          View: {
            show: ["stock_movement.view_stock"],
            hide: [
              "stock_movement.transfer_stock",
              "stock_movement.edit_stock",
            ],
          },
        },
      },
      {
        name: "",
        hideFields: [],
        disableFields: { Add: [], Edit: [], View: [] },
        pageSpecificFields: {
          Add: { show: [], hide: [] },
          Edit: { show: [], hide: [] },
          View: { show: [], hide: [] },
        },
      },
    ];

    // Update category options for Location Transfer
    if (movementTypeName === "Location Transfer") {
      const allowedCategories = [
        "Unrestricted",
        "Quality Inspection",
        "Blocked",
        "Reserved",
      ];
      this.setOptionData(
        ["sm_item_balance.table_item_balance.category"],
        allowedCategories.map((category) => ({
          label: category,
          value: category,
        }))
      );
    }

    // Reset UI
    const allFields = [
      ...new Set(
        uiConditions.flatMap((condition) => [
          ...condition.hideFields,
          ...(condition.disableFields.Add || []),
          ...(condition.disableFields.Edit || []),
          ...(condition.disableFields.View || []),
          ...(condition.pageSpecificFields.Add?.show || []),
          ...(condition.pageSpecificFields.Add?.hide || []),
          ...(condition.pageSpecificFields.Edit?.show || []),
          ...(condition.pageSpecificFields.Edit?.hide || []),
          ...(condition.pageSpecificFields.View?.show || []),
          ...(condition.pageSpecificFields.View?.hide || []),
        ])
      ),
    ];

    allFields.forEach((field) => {
      this.display(field);
      this.disabled([field], false);
    });

    // Apply UI conditions
    const matchedCondition = uiConditions.find(
      (condition) => movementTypeId === stockMovementMap[condition.name]
    );

    if (matchedCondition) {
      matchedCondition.hideFields.forEach((field) => this.hide(field));

      if (pageAction && matchedCondition.pageSpecificFields?.[pageAction]) {
        const { show = [], hide = [] } =
          matchedCondition.pageSpecificFields[pageAction];
        show.forEach((field) => this.display(field));
        hide.forEach((field) => this.hide(field));
      }

      if (pageAction && matchedCondition.disableFields?.[pageAction]) {
        this.disabled(matchedCondition.disableFields[pageAction], true);
      }
    } else {
      console.warn(
        `No UI condition matched for movement type ID: ${movementTypeId}`
      );
    }

    // Apply button visibility logic
    if (
      pageStatus === "Draft" &&
      (pageAction === "Add" || pageAction === "Edit")
    ) {
      hideAllButtons();
      switch (movementTypeName) {
        case "Inter Operation Facility Transfer":
          showButton("button_issued_ift");
          showButton("button_save_as_draft");
          break;
        case "Location Transfer":
          showButton("button_save_as_draft");
          showButton("button_completed");
          break;
        case "Miscellaneous Issue":
        case "Miscellaneous Receipt":
        case "Disposal/Scrap":
          showButton("button_save_as_draft");
          showButton("button_completed");
          showButton("comp_post_button");
          break;
        case "Inventory Category Transfer Posting":
          showButton("button_save_as_draft");
          showButton("button_completed");
          break;
        case "Inter Operation Facility Transfer (Receiving)":
          showButton("button_save_as_draft");
          showButton("button_complete_receive");
          showButton("comp_post_button");
          break;
      }
    } else if (
      pageStatus === "Issued" &&
      pageAction === "Edit" &&
      movementTypeName === "Inter Operation Facility Transfer"
    ) {
      hideAllButtons();
      showButton("button_inprogress_ift");
    } else if (pageStatus === "Completed" && pageAction === "View") {
      hideAllButtons();
      if (
        [
          "Inter Operation Facility Transfer",
          "Miscellaneous Issue",
          "Miscellaneous Receipt",
          "Disposal/Scrap",
          "Inter Operation Facility Transfer (Receiving)",
        ].includes(movementTypeName)
      ) {
        showButton("button_post");
      }
    }

    if (movementTypeId) {
      this.disabled(["stock_movement"], false);
    } else {
      this.disabled(["stock_movement"], true);
    }
  } catch (error) {
    console.error("Failed to enhance stock movement UI:", {
      message: error.message,
      stack: error.stack,
    });
    this.showError?.("Unable to load stock movement configuration");
  }
};

enhanceStockMovementUI();

if (
  this.getParamsVariables("page_status") === "Edit" ||
  this.getParamsVariables("page_status") === "View"
) {
  const newValues = this.getValues();
  const newMovementType = newValues.movement_type;

  if (newMovementType === originalMovementType) {
    setTimeout(() => {
      this.setData({
        balance_index: savedBalanceIndex,
      });
      console.log("Restored balance_index", this.getValues());
    }, 1000);
  }
}
