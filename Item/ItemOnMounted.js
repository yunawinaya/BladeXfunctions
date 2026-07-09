const showStatusHTML = async (status) => {
  switch (status) {
    case 1:
      this.display(["active_status"]);
      break;
    case 0:
      this.display(["inactive_status"]);
      break;
    default:
      break;
  }
};

const enabledBatchManagement = async () => {
  const stockControl = this.getValue("stock_control");

  if (stockControl === 0) {
    this.display("show_delivery");
    this.display("show_receiving");

    this.disabled(["item_batch_management", "batch_number_genaration"], true);
  } else if (stockControl === 1) {
    this.hide("show_delivery");
    this.hide("show_receiving");
  }
};

const enabledSerialNumberManagement = async () => {
  const serialNumberManagement = this.getValue("serial_number_management");

  if (serialNumberManagement === 1) {
    this.display("is_single_unit_serial");
    this.display("serial_no_generate_rule");
  } else {
    this.hide("is_single_unit_serial");
    this.hide("serial_no_generate_rule");
  }
};

const checkLastTransactionDate = async () => {
  const lastTransactionDate = this.getValue("last_transaction_date");
  const integrationType = this.getValue("acc_integration_type");
  console.log("lastTransactionDate", lastTransactionDate);
  if (!lastTransactionDate || lastTransactionDate === null) {
    this.display("batch_number_genaration");
    this.disabled(
      [
        "item_batch_management",
        "batch_number_genaration",
        "serial_number_management",
        "item_category",
        "stock_control",
        "based_uom",
        `table_uom_conversion.alt_uom_id`,
        `table_uom_conversion.base_qty`,
      ],
      false,
    );

    this.disabled(
      [`table_uom_conversion.0.alt_uom_id`, `table_uom_conversion.0.base_qty`],
      true,
    );

    this.setData({ previous_based_uom: this.getValue("based_uom") });
    await enabledSerialNumberManagement();
    await enabledBatchManagement();

    if (integrationType === "AutoCount Accounting") {
      this.disabled(["material_costing_method"], false);
    }
  } else {
    const uomConversion = this.getValue("table_uom_conversion");
    const fieldsToDisable = uomConversion.flatMap((_, index) => [
      `table_uom_conversion.${index}.alt_uom_id`,
      `table_uom_conversion.${index}.base_qty`,
    ]);

    console.log("fieldsToDisable", fieldsToDisable);
    this.disabled(fieldsToDisable, true);
    this.disabled(
      [
        "item_batch_management",
        "batch_number_genaration",
        "serial_number_management",
        "item_category",
        "stock_control",
        "based_uom",
      ],
      true,
    );
  }

  document
    .querySelectorAll(
      "#pane-tab_uom_conversion button.el-button--danger.el-button--small",
    )
    .forEach((button) => {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
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

      if (aiData.acc_integration_type === "No Accounting Integration") {
        this.hide("button_save_post");
      } else if (aiData.acc_integration_type === "SQL Accounting") {
        await getIsBaseValue(organizationId);
      }
    }
  }
};

const getIsBaseValue = async (organizationId) => {
  const resItem = await db
    .collection("Item")
    .where({ organization_id: organizationId })
    .get();

  const itemData = resItem.data.find((item) => item.is_base);

  const isBase = itemData.is_base || null;
  console.log("item", itemData);

  this.setData({ is_base: isBase });
};

const enabledDefaultBin = async () => {
  const tableDefaultBin = this.getValue("table_default_bin");

  for (const [index, bin] of tableDefaultBin.entries()) {
    if (bin.plant_id && bin.plant_id !== null) {
      this.disabled(`table_default_bin.${index}.bin_location`, false);
    }
  }
};

const enabledDefaultUOM = async () => {
  const basedUOM = this.getValue("based_uom");
  const UOMConversion = this.getValue("table_uom_conversion");

  if (
    (!basedUOM || basedUOM === null) &&
    (!UOMConversion || UOMConversion.length === 0)
  ) {
    this.disabled(["purchase_default_uom", "sales_default_uom"], true);
  }
};

const rearrangeTableUOMConversion = async () => {
  const tableUOMConversion = this.getValue("table_uom_conversion");

  const basedUOMConversion = tableUOMConversion.find(
    (uom) => uom.alt_uom_id === uom.base_uom_id,
  );

  if (basedUOMConversion) {
    this.setData({
      table_uom_conversion: [
        basedUOMConversion,
        ...tableUOMConversion.filter(
          (uom) => uom.alt_uom_id !== uom.base_uom_id,
        ),
      ],
    });
  }
};

(async () => {
  try {
    const activeStatus = await this.getValue("is_active");

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

    this.setData({ organization_id: organizationId, page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        this.display(["active_status"]);
        await checkAccIntegrationType(organizationId);

        setTimeout(() => {
          const integrationType = this.getValue("acc_integration_type");
          if (
            integrationType === "AutoCount Accounting" ||
            integrationType === "AutoCount Accounting V2"
          ) {
            this.disabled(["material_costing_method"], false);
          }
        }, 50);
        this.disabled(
          [
            "table_uom_conversion",
            "table_supplier_price",
            "table_customer_price",
          ],
          true,
        );
        this.disabled(["purchase_default_uom", "sales_default_uom"], false);
        this.setData({
          item_properties: "Default",
        });
        break;

      case "Edit":
        showStatusHTML(activeStatus);
        await rearrangeTableUOMConversion();
        await enabledBatchManagement();
        await enabledSerialNumberManagement();
        this.triggerEvent("onChange_batch_management");
        await checkAccIntegrationType(organizationId);
        await enabledDefaultBin();
        await enabledDefaultUOM();
        this.disabled(
          [
            "material_type",
            "item_category",
            "material_costing_method",
            "stock_control",
            "based_uom",
            "barcode_number",
            "table_uom_conversion.0.alt_uom_id",
          ],
          true,
        );

        await checkLastTransactionDate();
        break;

      case "Clone":
        this.display(["active_status"]);
        break;

      case "View":
        await rearrangeTableUOMConversion();
        await enabledBatchManagement();
        await enabledSerialNumberManagement();
        this.triggerEvent("onChange_batch_management");
        this.hide(["button_cancel", "button_save", "button_save_post"]);
        showStatusHTML(activeStatus);
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
    const op = await this.onDropdownVisible("material_code_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("material_code");
  const { options } = params;

  const optionsData = this.getOptionData("material_code_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("material_code_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        material_code_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ material_code_type: defaultData.value });
    }
  }
}, 200);
