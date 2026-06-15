const showStatusHTML = (status) => {
  const statusMap = {
    Draft: "draft_status",
    Created: "created_status",
    "In Progress": "processing_status",
    Completed: "completed_status",
    Cancelled: "cancel_status",
  };

  if (statusMap[status]) {
    this.display([statusMap[status]]);
  }
};

const CONFIG = {
  fields: {
    all: [
      "stock_movement.item_selection",
      "stock_movement.transfer_stock",
      "stock_movement.total_quantity",
      "stock_movement.quantity_uom",
      "stock_movement.stock_summary",
      "movement_reason",
      "is_production_order",
    ],
    buttons: ["button_save_as_draft", "button_inprogress", "button_completed"],
    hide: [
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.category",
      "receiving_operation_faci",
    ],
  },
  buttonConfig: {
    Add: ["button_save_as_draft", "button_inprogress", "button_completed"],
    Draft: ["button_save_as_draft", "button_inprogress", "button_completed"],
    Created: ["button_inprogress", "button_completed"],
    "In Progress": ["button_inprogress", "button_completed"],
  },
};

const initMovementReason = async () => {
  const resType = await db
    .collection("blade_dict")
    .where({ dict_key: "Inventory Category Transfer Posting" })
    .get();

  const movementTypeId = resType.data[0]?.id;

  if (movementTypeId) {
    const resReason = await db
      .collection("blade_dict")
      .where({ parent_id: movementTypeId })
      .get();
    this.setOptionData("movement_reason", resReason.data);
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
    this.display(CONFIG.buttonConfig.Draft);
  } else if (stockMovementStatus === "Created") {
    this.display(CONFIG.buttonConfig.Created);
  } else if (stockMovementStatus === "In Progress") {
    this.display(CONFIG.buttonConfig["In Progress"]);
  }
};

const showProductionOrder = (data) => {
  if (data.is_production_order === 1) {
    this.display(["production_order_id", "is_production_order"]);
    this.disabled(["stock_movement.item_selection"], true);
  }
};

const editDisabledField = () => {
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
    ],
    true,
  );

  setTimeout(() => {
    const editButtons = document.querySelectorAll(
      ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--default.is-link",
    );
    editButtons.forEach((button) => {
      button.style.display = "none";
    });

    // Inject CSS to override hover behavior and keep row numbers visible
    const styleId = "lot-hide-row-actions";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .fm-virtual-table__row-cell .scope-action { display: none !important; }
        .fm-virtual-table__row-cell .scope-index { display: flex !important; }
      `;
      document.head.appendChild(style);
    }
  }, 500);

  this.hide(["stock_movement.transfer_stock"]);
};

const hideSerialNumberRecordTab = () => {
  setTimeout(() => {
    const tableSerialNumber = this.getValue("table_sn_records");
    if (!tableSerialNumber || tableSerialNumber.length === 0) {
      const tab = document.querySelector(
        '.el-drawer[role="dialog"] .el-tabs__item#tab-serial_number_records',
      );
      if (tab) {
        tab.style.display = "none";
      }
    }
  }, 10);
};

const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];
  const isSameDept = currentDept === organizationId;

  this.disabled("issuing_operation_faci", !isSameDept);

  if (pageStatus === "Add" && !isSameDept) {
    this.setData({ issuing_operation_faci: currentDept });
  }
  return currentDept;
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

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({
      page_status: pageStatus,
      movement_type: "Category Transfer",
    });
    this.disabled(["movement_type"], true);

    switch (pageStatus) {
      case "Add":
        const nickName = this.getVarGlobal("nickname");
        this.setData({
          organization_id: organizationId,
          issued_by: nickName,
          issue_date: new Date().toISOString().split("T")[0],
        });

        this.display(["draft_status", "button_save_as_draft"]);
        this.hide(CONFIG.fields.hide);

        hideSerialNumberRecordTab();
        configureFields(data.is_production_order);
        configureButtons(pageStatus, null);
        await initMovementReason();
        break;

      case "Edit":
        this.hide(CONFIG.fields.hide);

        configureFields(data.is_production_order);
        configureButtons(pageStatus, data.stock_movement_status);

        if (data.stock_movement_status === "Completed") {
          editDisabledField();
        } else if (data.stock_movement_status === "In Progress") {
          setTimeout(async () => {
            this.disabled(
              ["issuing_operation_faci", "issue_date", "movement_reason"],
              true,
            );
          }, 100);

          setTimeout(() => {
            const editButtons = document.querySelectorAll(
              ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--default.is-link",
            );
            editButtons.forEach((button) => {
              button.style.display = "none";
            });

            // Inject CSS to override hover behavior and keep row numbers visible
            const styleId = "lot-hide-row-actions";
            if (!document.getElementById(styleId)) {
              const style = document.createElement("style");
              style.id = styleId;
              style.textContent = `
                .fm-virtual-table__row-cell .scope-action { display: none !important; }
                .fm-virtual-table__row-cell .scope-index { display: flex !important; }
              `;
              document.head.appendChild(style);
            }
          }, 500);
        } else if (data.stock_movement_status === "Draft") {
          setPlant(organizationId, pageStatus);
        }

        showProductionOrder(data);
        showStatusHTML(data.stock_movement_status);
        hideSerialNumberRecordTab();
        break;

      case "View":
        this.hide(CONFIG.fields.hide);

        configureFields(data.is_production_order);
        configureButtons(pageStatus, data.stock_movement_status);
        showStatusHTML(data.stock_movement_status);
        showProductionOrder(data);
        hideSerialNumberRecordTab();
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

setTimeout(async () => {
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("stock_movement_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("stock_movement_no");
  const { options } = params;

  const optionsData = this.getOptionData("stock_movement_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("stock_movement_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        stock_movement_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ stock_movement_no_type: defaultData.value });
    }
  }
}, 200);
