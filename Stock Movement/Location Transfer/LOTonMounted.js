const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "In Progress":
      this.display(["processing_status"]);
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

const CONFIG = {
  fields: {
    all: [
      "stock_movement.item_selection",
      "stock_movement.view_stock",
      "stock_movement.transfer_stock",
      "stock_movement.edit_stock",
      "stock_movement.total_quantity",
      "stock_movement.quantity_uom",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "stock_movement.stock_summary",
      "movement_reason",
      "is_production_order",
    ],
    buttons: ["button_save_as_draft", "button_completed"],
    hide: [
      "stock_movement.to_recv_qty",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.category",
      "stock_movement.batch_id",
      "stock_movement.select_serial_number",
      "delivery_method",
      "receiving_operation_faci",
    ],
  },
  hideFields: {
    Add: ["stock_movement.edit_stock", "stock_movement.view_stock"],
    View: ["stock_movement.transfer_stock", "stock_movement.edit_stock"],
    Edit: ["stock_movement.view_stock", "stock_movement.transfer_stock"],
  },
  buttonConfig: {
    Add: ["button_save_as_draft", "button_completed"],
    Draft: ["button_save_as_draft", "button_completed"],
    Created: ["button_completed"],
  },
};

const initMovementReason = async () => {
  const resType = await db
    .collection("blade_dict")
    .where({ dict_key: "Location Transfer" })
    .get();

  const movementTypeId = resType.data[0]?.id;

  if (movementTypeId) {
    const resReason = await db
      .collection("blade_dict")
      .where({ parent_id: movementTypeId })
      .get();
    await this.setOptionData("movement_reason", resReason.data);
  }
};

const configureFields = (isProductionOrder) => {
  this.display(CONFIG.fields.all);
  this.hide(CONFIG.fields.hide);

  if (isProductionOrder) {
    this.display(["stock_movement.requested_qty"]);
  }

  this.disabled(["stock_movement.total_quantity"], true);
};

const configureButtons = (pageStatus, stockMovementStatus) => {
  this.hide(CONFIG.fields.buttons);

  if (pageStatus === "Add" || stockMovementStatus === "Draft") {
    this.display(CONFIG.buttonConfig.Add);
  } else if (stockMovementStatus === "Created") {
    this.display(CONFIG.buttonConfig.Created);
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

const editDisabledField = async () => {
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
      "reference_documents",
      "movement_id",
      "is_production_order",
      "production_order_id",
      "stock_movement",
      "stock_movement.item_selection",
      "stock_movement.total_quantity",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
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
  }, 10);
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

    if (smTable && smTable.length > 0) {
      for (const [index, item] of smTable.entries()) {
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

          if (binLocationData) {
            this.setData({
              [`stock_movement.${index}.storage_location_id`]:
                binLocationData.storage_location_id,
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Error setting storage location:", error);
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

    // Set movement type to Location Transfer
    this.setData({ movement_type: "Location Transfer" });
    this.disabled(["movement_type"], true);

    switch (pageStatus) {
      case "Add":
        const nickName = await this.getVarGlobal("nickname");
        this.setData({
          organization_id: organizationId,
          issued_by: nickName,
          issue_date: new Date().toISOString().split("T")[0],
        });

        this.disabled(["stock_movement"], true);
        this.display(["draft_status", "button_save_as_draft"]);
        this.hide([
          "stock_movement.view_stock",
          "stock_movement.edit_stock",
        ]);
        this.hide(CONFIG.fields.hide);

        await setPlant(organizationId, pageStatus);
        await initMovementReason();
        await hideSerialNumberRecordTab();
        await setStorageLocation();
        await configureFields(data.is_production_order);
        await configureButtons(pageStatus, null);
        break;

      case "Edit":
        this.hide([
          "stock_movement.transfer_stock",
          "stock_movement.view_stock",
        ]);

        if (data.stock_movement_status === "Completed") {
          await editDisabledField();
        }

        await configureFields(data.is_production_order);
        await configureButtons(pageStatus, data.stock_movement_status);

        this.hide(CONFIG.hideFields[pageStatus]);
        if (data.stock_movement_status === "Draft") {
          await setPlant(organizationId, pageStatus);
        }
        await showProductionOrder(data);
        await showStatusHTML(data.stock_movement_status);
        await hideSerialNumberRecordTab();
        await setStorageLocation();
        break;

      case "View":
        await configureFields(data.is_production_order);
        await configureButtons(pageStatus, data.stock_movement_status);
        this.hide([
          "stock_movement.transfer_stock",
          "stock_movement.view_stock",
          "stock_movement.edit_stock",
        ]);

        await showStatusHTML(data.stock_movement_status);
        await showProductionOrder(data);
        await hideSerialNumberRecordTab();
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
