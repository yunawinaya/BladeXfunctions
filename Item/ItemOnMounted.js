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

const checkUniqueness = async (generatedPrefix) => {
  const existingDoc = await db
    .collection("Item")
    .where({ material_code: generatedPrefix })
    .get();
  return existingDoc.data[0] ? false : true;
};

const findUniquePrefix = async (prefixData) => {
  const now = new Date();
  let prefixToShow;
  let runningNumber = prefixData.running_number;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix(runningNumber, now, prefixData);
    isUnique = await checkUniqueness(prefixToShow);
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
  const { prefixToShow } = await findUniquePrefix(prefixData);
  this.setData({ material_code: prefixToShow });
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

  if (prefixData.is_active === 0) {
    this.disabled(["material_code"], false);
  }

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
        break;

      case "Edit":
        const itemId = this.getValue("item_no");
        await getPrefixData(organizationId);

        if (itemId) {
          db.collection("Item")
            .where({ id: itemId })
            .get()
            .then((resItem) => {
              if (resItem.data && resItem.data.length > 0) {
                const item = resItem.data[0];
                this.setData(item);
                showStatusHTML(item.is_active);

                // Disable specific fields in Edit mode
                this.disabled(
                  [
                    "material_type",
                    "material_code",
                    "material_name",
                    "material_category",
                    "material_sub_category",
                    "material_costing_method",
                    "stock_control",
                    "based_uom",
                  ],
                  true
                );
                this.setData({ posted_status: 0 });
              }
            });
        }
        break;

      case "Clone":
        this.display(["active_status"]);
        await setPrefix(organizationId);
        break;

      case "View":
        this.hide(["button_cancel", "button_save"]);

        const itemIdView = this.getValue("item_no");

        if (itemIdView) {
          db.collection("Item")
            .where({ id: itemIdView })
            .get()
            .then((resItem) => {
              if (resItem.data && resItem.data.length > 0) {
                const item = resItem.data[0];
                this.setData(item);
                showStatusHTML(item.is_active);

                // Disable all fields in View mode
                this.disabled(
                  [
                    "is_active",
                    "imgupload_wk19nrhg",
                    "material_type",
                    "material_code",
                    "material_name",
                    "material_category",
                    "material_sub_category",
                    "material_desc",
                    "material_costing_method",
                    "stock_control",
                    "show_delivery",
                    "show_receiving",
                    "based_uom",
                    "table_uom_conversion",
                    "purchase_tariff_id",
                    "mat_purchase_currency_id",
                    "mat_purchase_tax_id",
                    "purchase_tax_percent",
                    "purchase_unit_price",
                    "sales_tariff_id",
                    "mat_sales_tax_id",
                    "sales_tax_percent",
                    "mat_sales_currency_id",
                    "sales_unit_price",
                    "item_batch_management",
                    "batch_number_genaration",
                    "brand_id",
                    "brand_artwork_id",
                    "subform_packaging_remark",
                    "reorder_level",
                    "shelf",
                    "lead_time",
                    "assembly_cost",
                    "bom_related",
                    "reorder_quantity",
                    "irbm_id",
                    "production_time",
                    "over_receive_tolerance",
                    "under_receive_tolerance",
                    "over_delivery_tolerance",
                    "under_delivery_tolerance",
                    "additional_remark",
                  ],
                  true
                );
              }
            });
        }
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
