const generatePrefix = (runNumber, now, prefixData) => {
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
    .collection("Item")
    .where({ material_code: generatedPrefix, organization_id: organizationId })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData, organizationId) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Item Code after maximum attempts"
    );
  }
  return { prefixToShow, runningNumber };
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);
  const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);

  if (prefixData.is_active === 0) {
    this.disabled(["material_code"], false);
    this.setData({ material_code: "", item_current_prefix: prefixToShow });
  } else {
    this.setData({
      material_code: prefixToShow,
      item_current_prefix: prefixToShow,
    });
  }
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Items",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();
  const prefixData = prefixEntry.data[0];

  return prefixData;
};

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

    const lastTransactionDate = this.getValue("last_transaction_date");
    if (!lastTransactionDate || lastTransactionDate === null) {
      this.display("batch_number_genaration");
      this.disabled(
        ["item_batch_management", "batch_number_genaration"],
        false
      );
    } else {
      this.disabled(["item_batch_management", "batch_number_genaration"], true);
    }
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

const checkAccIntegrationType = async (organizationId) => {
  if (organizationId) {
    const resAI = await db
      .collection("accounting_integration")
      .where({ organization_id: organizationId })
      .get();

    if (resAI && resAI.data.length > 0) {
      const aiData = resAI.data[0];

      if (aiData.acc_integration_type === "No Accounting Integration") {
        this.hide("button_save_post");
      } else {
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
        await setPrefix(organizationId);
        await checkAccIntegrationType(organizationId);

        this.disabled(["purchase_default_uom", "sales_default_uom"], false);
        break;

      case "Edit":
        showStatusHTML(activeStatus);
        await enabledBatchManagement();
        await enabledSerialNumberManagement();
        this.triggerEvent("onChange_batch_management");
        await checkAccIntegrationType(organizationId);
        await enabledDefaultBin();
        await enabledDefaultUOM();
        this.disabled(
          [
            "material_type",
            "material_code",
            "material_name",
            "item_category",
            "material_costing_method",
            "stock_control",
            "based_uom",
            "barcode_number",
          ],
          true
        );

        break;

      case "Clone":
        this.display(["active_status"]);
        await setPrefix(organizationId);
        break;

      case "View":
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
