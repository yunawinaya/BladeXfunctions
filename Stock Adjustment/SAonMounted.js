const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Fully Posted":
      this.display(["fullyposted_status"]);
      break;
    default:
      break;
  }
};

const generatePrefix = (prefixData) => {
  const now = new Date();
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
    String(prefixData.running_number).padStart(prefixData.padding_zeroes, "0")
  );
  return generated;
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  try {
    const existingDoc = await db
      .collection("stock_adjustment")
      .where({
        adjustment_no: generatedPrefix,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get();
    return !existingDoc.data || existingDoc.data.length === 0;
  } catch (error) {
    console.error("Error checking uniqueness:", error);
    return false;
  }
};

const findUniquePrefix = async (prefixData, organizationId) => {
  let prefixToShow;
  let runningNumber = prefixData.running_number || 1;
  let isUnique = false;
  let maxAttempts = 10;
  let attempts = 0;

  while (!isUnique && attempts < maxAttempts) {
    attempts++;
    prefixToShow = generatePrefix({
      ...prefixData,
      running_number: runningNumber,
    });
    isUnique = await checkUniqueness(prefixToShow, organizationId);
    if (!isUnique) {
      runningNumber++;
    }
  }

  if (!isUnique) {
    throw new Error(
      "Could not generate a unique Stock Adjustment number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const checkPrefixConfiguration = async (organizationId) => {
  try {
    const prefixEntry = await db
      .collection("prefix_configuration")
      .where({
        document_types: "Stock Adjustment",
        is_deleted: 0,
        organization_id: organizationId,
      })
      .get();

    return prefixEntry.data && prefixEntry.data.length > 0
      ? prefixEntry.data[0]
      : null;
  } catch (error) {
    console.error("Error checking prefix configuration:", error);
    return null;
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
        this.hide(["button_completed_posted", "button_posted"]);
      }
    }
  }
};

const setPrefix = async (organizationId) => {
  const prefixData = await checkPrefixConfiguration(organizationId);
  let newPrefix = "";

  if (prefixData) {
    if (prefixData.is_active === 1) {
      const { prefixToShow } = await findUniquePrefix(
        prefixData,
        organizationId
      );
      newPrefix = prefixToShow;
      this.disabled(["adjustment_no"], true);
    } else if (prefixData.is_active === 0) {
      this.disabled(["adjustment_no"], false);
    }
    this.setData({ adjustment_no: newPrefix });
  }
};

const disabledEditField = async (stockAdjustmentStatus) => {
  if (stockAdjustmentStatus === "Draft") {
    this.hide("button_posted");
    this.hide("stock_adjustment.readjust_link");
    this.hide("stock_adjustment.view_link");
  } else {
    this.disabled(
      [
        "stock_adjustment_status",
        "adjustment_no",
        "adjustment_date",
        "adjustment_type",
        "adjusted_by",
        "plant_id",
        "stock_adjustment",
        "adjustment_remarks",
        "table_item_balance",
        "reference_documents",
        "stock_adjustment.adjustment_reason",
        "stock_adjustment.adjustment_remarks",
        "stock_adjustment.material_id",
        "stock_adjustment.total_quantity",
      ],
      true
    );
    this.hide([
      "stock_adjustment.link_adjust_stock",
      "stock_adjustment.view_link",
    ]);

    if (stockAdjustmentStatus === "Fully Posted") {
      this.hide([
        "button_posted",
        "button_save_as_draft",
        "button_completed",
        "button_completed_posted",
      ]);
    } else {
      this.display(["button_posted"]);
      this.hide([
        "button_save_as_draft",
        "button_completed",
        "button_completed_posted",
      ]);
    }
  }
};

(async () => {
  try {
    let pageStatus = "";
    const data = this.getValues();

    // Determine page status
    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    this.setData({ page_status: pageStatus });

    // Get organization ID
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    switch (pageStatus) {
      case "Add":
        this.display(["draft_status"]);
        this.hide([
          "stock_adjustment.view_link",
          "stock_adjustment.readjust_link",
          "stock_adjustment.readjust_link",
          "button_posted",
        ]);

        this.setData({
          adjustment_date: new Date().toISOString().split("T")[0],
          adjusted_by: this.getVarGlobal("nickname"),
          organization_id: organizationId,
        });

        this.disabled(["adjustment_type", "stock_adjustment"], true);

        await checkAccIntegrationType(organizationId);
        await setPrefix(organizationId);
        break;

      case "Edit":
        // Check if prefix is active
        const prefixConfig = await checkPrefixConfiguration(organizationId);
        if (prefixConfig && prefixConfig.is_active === 0) {
          this.disabled(["adjustment_no"], false);
        } else if (prefixConfig && prefixConfig.is_active === 1) {
          this.disabled(["adjustment_no"], true);
        }

        await showStatusHTML(data.stock_adjustment_status);
        await disabledEditField(data.stock_adjustment_status);
        await checkAccIntegrationType(organizationId);
        break;

      case "View":
        if (data.adjustment_type === "Write Off") {
          this.hide("stock_adjustment.unit_price");
        }

        this.hide([
          "stock_adjustment.link_adjust_stock",
          "stock_adjustment.readjust_link",
          "button_save_as_draft",
          "button_completed",
          "button_completed_posted",
          "button_posted",
        ]);

        await showStatusHTML(data.stock_adjustment_status);
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
