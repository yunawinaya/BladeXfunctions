const showStatusHTML = (status) => {
  const statusMap = {
    Draft: "draft_status",
    Issued: "issued_status",
    "In Progress": "processing_status",
    Created: "created_status",
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
      "stock_movement.transfer_stock",
      "stock_movement.total_quantity",
      "stock_movement.to_recv_qty",
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.quantity_uom",
      "stock_movement.category",
      "stock_movement.stock_summary",
      "movement_reason",
      "delivery_method",
      "receiving_operation_faci",
    ],
    buttons: [
      "button_post",
      "comp_post_button",
      "button_inprogress_ift",
      "button_complete_receive",
      "button_save_as_draft",
      "button_issued_ift",
    ],
    hide: [
      "stock_movement.view_stock",
      "stock_movement.edit_stock",
      "stock_movement.unit_price",
      "stock_movement.amount",
      "stock_movement.location_id",
      "stock_movement.storage_location_id",
      "is_production_order",
      "stock_movement.batch_id",
    ],
  },
  hideFields: {
    "Plant Transfer": [
      "stock_movement.received_quantity",
      "stock_movement.received_quantity_uom",
      "stock_movement.category",
      "stock_movement.to_recv_qty",
    ],
    "Plant Transfer (Receiving)": [
      "stock_movement.transfer_stock",
      "stock_movement.total_quantity",
      "stock_movement.quantity_uom",
      "delivery_method",
      "receiving_operation_faci",
      "stock_movement.stock_summary",
    ],
  },
  buttonConfig: {
    Add: ["button_save_as_draft", "button_issued_ift"],
    Draft: ["button_save_as_draft", "button_issued_ift"],
    Issued: ["button_inprogress_ift"],
    Created: {
      "Plant Transfer (Receiving)": ["button_complete_receive"],
    },
    Completed: ["button_post"],
  },
};

const initMovementReason = async () => {
  const resType = await db
    .collection("blade_dict")
    .where({ dict_key: "Plant Transfer" })
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

const configureFields = (movementType) => {
  this.display(CONFIG.fields.all);
  this.hide(CONFIG.fields.hide);

  if (CONFIG.hideFields[movementType]) {
    this.hide(CONFIG.hideFields[movementType]);
  }

  if (movementType === "Plant Transfer (Receiving)") {
    this.disabled(["stock_movement.received_quantity_uom"], true);
    this.disabled(["stock_movement.category"], false);
  }
};

const configureButtons = (pageStatus, stockMovementStatus, movementType) => {
  this.hide(CONFIG.fields.buttons);

  if (pageStatus === "Add" || stockMovementStatus === "Draft") {
    this.display(CONFIG.buttonConfig.Draft);
  } else if (stockMovementStatus === "Issued") {
    this.display(CONFIG.buttonConfig.Issued);
  } else if (
    stockMovementStatus === "Created" &&
    movementType === "Plant Transfer (Receiving)"
  ) {
    this.display(CONFIG.buttonConfig.Created["Plant Transfer (Receiving)"]);
  } else if (
    stockMovementStatus === "Completed" ||
    stockMovementStatus === "Fully Posted"
  ) {
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

const displayDeliveryField = async () => {
  const deliveryMethodName = this.getValue("delivery_method");

  const fields = [
    "self_pickup",
    "courier_service",
    "company_truck",
    "shipping_service",
    "third_party_transporter",
  ];

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

    if (!selectedField) {
      this.hide(fields);
    } else {
      fields.forEach((field) => {
        field === selectedField ? this.display(field) : this.hide(field);
      });
    }
  } else {
    this.setData({ delivery_method_text: "" });
    this.hide(fields);
  }
};

const filterPTReceivingCategory = async () => {
  const data = this.getValues();
  const stockMovement = data.stock_movement;

  const categoryObjectResponse = await db
    .collection("blade_dict")
    .where({ code: "inventory_category" })
    .get();

  const allowedCategories = ["Unrestricted", "Quality Inspection", "Blocked"];

  const filteredCategories = categoryObjectResponse.data.filter((category) =>
    allowedCategories.includes(category.dict_key),
  );

  for (const [rowIndex, _sm] of stockMovement.entries()) {
    await this.setOptionData(
      [`stock_movement.${rowIndex}.category`],
      filteredCategories,
    );
  }
};

const displayManufacturingAndExpiredDate = async (status, pageStatus) => {
  const tableSM = this.getValue("stock_movement");

  if (pageStatus === "Edit" && status === "Created") {
    for (const [index, item] of tableSM.entries()) {
      if (item.batch_id && item.batch_id !== "-") {
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
  } else if (pageStatus === "View" || status === "Completed") {
    for (const [_index, item] of tableSM.entries()) {
      if (item.batch_id && item.batch_id !== "-") {
        await this.display([
          "stock_movement.manufacturing_date",
          "stock_movement.expired_date",
        ]);
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
      "delivery_method",
      "reference_documents",
      "receiving_operation_faci",
      "movement_id",

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

    const styleId = "pt-hide-row-actions";
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

    this.setData({ page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        const nickName = this.getVarGlobal("nickname");
        this.setData({
          organization_id: organizationId,
          issued_by: nickName,
          issue_date: new Date().toISOString().split("T")[0],
          movement_type: "Plant Transfer",
        });

        this.disabled(["stock_movement", "movement_type"], true);
        this.display(["draft_status"]);

        configureFields("Plant Transfer");
        configureButtons(pageStatus, null, "Plant Transfer");
        setPlant(organizationId, pageStatus);
        hideSerialNumberRecordTab();
        await initMovementReason();
        await checkAccIntegrationType(organizationId);
        break;

      case "Edit":
        const movementType = data.movement_type;

        this.disabled("movement_type", true);

        configureFields(movementType);
        configureButtons(pageStatus, data.stock_movement_status, movementType);

        if (
          data.stock_movement_status === "Created" &&
          movementType === "Plant Transfer (Receiving)"
        ) {
          this.disabled(["stock_movement.received_quantity"], true);
          await filterPTReceivingCategory();
          await displayManufacturingAndExpiredDate(
            data.stock_movement_status,
            pageStatus,
          );
        }

        if (
          data.stock_movement_status === "Completed" ||
          data.stock_movement_status === "Fully Posted"
        ) {
          editDisabledField();
          if (movementType === "Plant Transfer (Receiving)") {
            await displayManufacturingAndExpiredDate(
              data.stock_movement_status,
              pageStatus,
            );
          }
        }

        if (data.stock_movement_status === "Issued") {
          this.disabled(
            [
              "issuing_operation_faci",
              "issue_date",
              "movement_reason",
              "stock_movement",
            ],
            true,
          );
        }

        if (data.stock_movement_status === "Draft") {
          setPlant(organizationId, pageStatus);
        }

        showStatusHTML(data.stock_movement_status);
        displayDeliveryField();
        hideSerialNumberRecordTab();
        await checkAccIntegrationType(organizationId);
        break;

      case "View":
        const viewMovementType = data.movement_type;

        configureFields(viewMovementType);
        configureButtons(
          pageStatus,
          data.stock_movement_status,
          viewMovementType,
        );
        this.hide(["stock_movement.transfer_stock"]);

        if (viewMovementType === "Plant Transfer (Receiving)") {
          await displayManufacturingAndExpiredDate(
            data.stock_movement_status,
            pageStatus,
          );
        }

        showStatusHTML(data.stock_movement_status);
        displayDeliveryField();
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
    await this.onDropdownVisible("stock_movement_no_type", true);
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
