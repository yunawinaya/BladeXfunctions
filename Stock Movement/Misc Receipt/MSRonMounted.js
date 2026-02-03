const showStatusHTML = (status) => {
  const statusMap = {
    Draft: "draft_status",
    Completed: "completed_status",
    "Fully Posted": "fullyposted_status",
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
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "stock_movement.batch_id",
      "stock_movement.category",
      "movement_reason",
    ],
    buttons: [
      "button_save_as_draft",
      "button_completed",
      "comp_post_button",
      "button_post",
    ],
    hide: ["receiving_operation_faci", "is_production_order"],
  },
  buttonConfig: {
    Draft: ["button_save_as_draft", "button_completed", "comp_post_button"],
    Completed: ["button_post"],
  },
};

const initMovementReason = async () => {
  const resType = await db
    .collection("blade_dict")
    .where({ dict_key: "Miscellaneous Receipt" })
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
  this.hide(CONFIG.fields.hide);
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
      "stock_movement.category",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "stock_movement.batch_id",
      "stock_movement.manufacturing_date",
      "stock_movement.expiry_date",
    ],
    true,
  );

  // Hide edit button
  setTimeout(() => {
    const editButton = document.querySelector(
      ".el-row .el-col.el-col-12.el-col-xs-24 .el-button.el-button--primary.el-button--small.is-link",
    );
    if (editButton) {
      editButton.style.display = "none";
    }
  }, 500);

  this.display("button_post");
};

const filterInvCategory = async (stockMovement) => {
  const allowedCategories = ["Unrestricted", "Blocked"];

  const categoryObjectResponse = await db
    .collection("blade_dict")
    .where({ code: "inventory_category" })
    .get();

  const filteredCategories = categoryObjectResponse.data.filter((category) =>
    allowedCategories.includes(category.dict_key),
  );

  for (const [index, _sm] of stockMovement.entries()) {
    await this.setOptionData(
      [`stock_movement.${index}.category`],
      filteredCategories,
    );
    this.disabled([`stock_movement.${index}.category`], false);
  }
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
          '.el-drawer[role="dialog"] .el-tabs__item#tab-serial_number_records',
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
  }, 10);
};

const displayManufacturingAndExpiredDate = async (status, pageStatus) => {
  const tableSM = this.getValue("stock_movement");

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
            false,
          );
        } else {
          await this.disabled(
            [
              `stock_movement.${index}.manufacturing_date`,
              `stock_movement.${index}.expired_date`,
            ],
            true,
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

setTimeout(async () => {
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

    switch (pageStatus) {
      case "Add":
        const nickName = this.getVarGlobal("nickname");
        this.setData({
          organization_id: organizationId,
          issued_by: nickName,
          issue_date: new Date().toISOString().split("T")[0],
          page_status: pageStatus,
          movement_type: "Miscellaneous Receipt",
        });

        this.disabled(["movement_type"], true);

        this.display(["draft_status", "button_save_as_draft"]);
        this.hide(CONFIG.fields.hide);

        const plantID = setPlant(organizationId, pageStatus);
        configureFields();
        configureButtons(pageStatus, null);
        hideSerialNumberRecordTab();
        await initMovementReason();
        await checkAccIntegrationType(organizationId);
        await setStorageLocation(plantID);
        break;

      case "Edit":
        this.hide(CONFIG.fields.hide);
        configureFields();
        configureButtons(pageStatus, data.stock_movement_status);

        const plantId = data.issuing_operation_faci;

        if (
          data.stock_movement_status === "Completed" ||
          data.stock_movement_status === "Fully Posted"
        ) {
          setTimeout(() => {
            editDisabledField();
          }, 200);
        }

        if (data.stock_movement_status === "Draft") {
          setPlant(organizationId, pageStatus);
          await filterInvCategory(data.stock_movement);
          await viewSerialNumber();
          await setStorageLocation(plantId);
        }

        showStatusHTML(data.stock_movement_status);
        hideSerialNumberRecordTab();
        await checkAccIntegrationType(organizationId);
        await displayManufacturingAndExpiredDate(
          data.stock_movement_status,
          pageStatus,
        );
        break;

      case "View":
        configureFields();
        configureButtons(pageStatus, data.stock_movement_status);
        this.hide(CONFIG.fields.hide);

        showStatusHTML(data.stock_movement_status);
        hideSerialNumberRecordTab();
        await checkAccIntegrationType(organizationId);
        await displayManufacturingAndExpiredDate(
          data.stock_movement_status,
          pageStatus,
        );
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
}, 500);

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
