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
        "adjustment_remarks2",
        "adjustment_remarks3",
        "table_item_balance",
        "reference_documents",
        "stock_adjustment.adjustment_reason",
        "stock_adjustment.adjustment_remarks",
        "stock_adjustment.material_id",
        "stock_adjustment.total_quantity",
      ],
      true,
    );

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

const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];

  if (currentDept === organizationId) {
    this.disabled("plant_id", false);
  } else {
    this.disabled("plant_id", true);
  }
  if (pageStatus === "Add" && currentDept !== organizationId) {
    this.setData({ plant_id: currentDept });
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
        await setPlant(organizationId, pageStatus);

        this.disabled(["adjustment_type", "stock_adjustment"], true);

        await checkAccIntegrationType(organizationId);
        break;

      case "Edit":
        this.setData({ previous_status: data.stock_adjustment_status });
        if (data.adjustment_type === "Write Off") {
          this.hide("stock_adjustment.unit_price");
        }

        if (data.stock_adjustment_status === "Draft") {
          await setPlant(organizationId, pageStatus);
        }

        await showStatusHTML(data.stock_adjustment_status);
        await disabledEditField(data.stock_adjustment_status);
        await checkAccIntegrationType(organizationId);

        if (data.stock_count_id && data.stock_count_id !== "") {
          await this.display(["stock_count_id"]);
        }
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

        if (data.stock_count_id && data.stock_count_id !== "") {
          await this.display(["stock_count_id"]);
        }
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
    const op = await this.onDropdownVisible("adjustment_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("adjustment_no");
  const { options } = params;

  const optionsData = this.getOptionData("adjustment_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("adjustment_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        adjustment_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ adjustment_no_type: defaultData.value });
    }
  }
}, 200);
