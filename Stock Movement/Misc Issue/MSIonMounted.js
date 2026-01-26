const showStatusHTML = (status) => {
  const statusMap = {
    Draft: "draft_status",
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
      "stock_movement.view_stock",
      "stock_movement.transfer_stock",
      "stock_movement.edit_stock",
      "stock_movement.total_quantity",
      "stock_movement.quantity_uom",
      "stock_movement.stock_summary",
      "movement_reason",
    ],
    buttons: [
      "button_post",
      "comp_post_button",
      "button_save_as_draft",
      "button_completed",
    ],
  },
  buttonConfig: {
    Add: ["button_save_as_draft", "button_completed", "comp_post_button"],
    Draft: ["button_save_as_draft", "button_completed", "comp_post_button"],
    Completed: ["button_post"],
  },
};

const initMovementReason = async () => {
  const resType = await db
    .collection("blade_dict")
    .where({ dict_key: "Miscellaneous Issue" })
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

const configureFields = () => {
  this.display(CONFIG.fields.all);
  this.disabled(["stock_movement.total_quantity"], true);
};

const configureButtons = (pageStatus, stockMovementStatus) => {
  this.hide(CONFIG.fields.buttons);

  if (pageStatus === "Add" || stockMovementStatus === "Draft") {
    this.display(CONFIG.buttonConfig.Draft);
  } else if (stockMovementStatus === "Completed") {
    this.display(CONFIG.buttonConfig.Completed);
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

    const styleId = "msi-hide-row-actions";
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
  this.display("button_post");
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

const setStorageLocation = async (plantID) => {
  try {
    if (plantID) {
      let defaultStorageLocationID = "";

      const resStorageLocation = await db
        .collection("storage_location")
        .where({
          plant_id: plantID,
          is_deleted: 0,
          is_default: 1,
          storage_status: 1,
          location_type: "Common",
        })
        .get();

      if (resStorageLocation.data && resStorageLocation.data.length > 0) {
        defaultStorageLocationID = resStorageLocation.data[0].id;
        this.setData({
          default_storage_location: defaultStorageLocationID,
        });
      }

      if (defaultStorageLocationID && defaultStorageLocationID !== "") {
        const resBinLocation = await db
          .collection("bin_location")
          .where({
            plant_id: plantID,
            storage_location_id: defaultStorageLocationID,
            is_deleted: 0,
            is_default: 1,
            bin_status: 1,
          })
          .get();

        if (resBinLocation.data && resBinLocation.data.length > 0) {
          this.setData({
            default_bin: resBinLocation.data[0].id,
          });
        }
      }
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
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

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({
      page_status: pageStatus,
      movement_type: "Miscellaneous Issue",
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

        this.disabled(["stock_movement"], true);
        this.display(["draft_status", "button_save_as_draft"]);

        const plantID = setPlant(organizationId, pageStatus);
        hideSerialNumberRecordTab();
        configureFields();
        configureButtons(pageStatus, null);
        await initMovementReason();
        await setStorageLocation(plantID);
        await checkAccIntegrationType(organizationId);
        break;

      case "Edit":
        configureFields();
        configureButtons(pageStatus, data.stock_movement_status);

        if (
          data.stock_movement_status === "Completed" ||
          data.stock_movement_status === "Fully Posted"
        ) {
          editDisabledField();
        } else if (data.stock_movement_status === "Draft") {
          setPlant(organizationId, pageStatus);
        }

        showStatusHTML(data.stock_movement_status);
        hideSerialNumberRecordTab();
        await checkAccIntegrationType(organizationId);
        break;

      case "View":
        this.hide(["stock_movement.transfer_stock"]);

        configureFields();
        configureButtons(pageStatus, data.stock_movement_status);
        showStatusHTML(data.stock_movement_status);
        hideSerialNumberRecordTab();
        await checkAccIntegrationType(organizationId);
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

setTimeout(async () => {
  if (this.isAdd) {
    const op = await this.onDropdownVisible("stock_movement_no_type", true);
    function getDefaultItem(arr) {
      return arr?.find((item) => item?.item?.item?.is_default === 1);
    }
    setTimeout(() => {
      const optionsData = this.getOptionData("stock_movement_no_type") || [];
      const data = getDefaultItem(optionsData);
      if (data) {
        this.setData({
          stock_movement_no_type: data.value,
        });
      }
    }, 500);
  }
}, 500);
