// Helper functions
const showStatusHTML = async (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    case "Cancelled":
      this.display(["cancelled_status"]);
      break;
    default:
      break;
  }
};

const disabledField = async (status) => {
  // Fields sourced upstream (from GD / SO / Picking) — should stay immutable
  // once the Packing has been created. User should not edit these on Created or Completed.
  const upstreamFields = [
    "plant_id",
    "organization_id",
    "packing_no",
    "packing_no_type",
    "gd_id",
    "gd_no",
    "so_id",
    "so_no",
    "to_id",
    "customer_id",
    "billing_address",
    "shipping_address",
  ];

  if (status === "Completed") {
    this.disabled(
      [
        ...upstreamFields,
        "packing_status",
        "packing_mode",
        "assigned_to",
        "created_by",
        "created_at",
        "ref_doc",
        "table_hu",
        "remarks",
      ],
      true,
    );
    this.hide(["button_save_as_draft", "button_created", "button_completed"]);
  } else if (status === "Created") {
    this.disabled(upstreamFields, true);
    this.disabled(["ref_doc"], false);
  } else {
    this.disabled(["ref_doc"], false);
  }
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";
  const plant = this.getValue("plant_id");

  if (!plant) {
    if (deptId === organizationId) {
      const resPlant = await db
        .collection("blade_dept")
        .where({ parent_id: deptId })
        .get();

      if (!resPlant && resPlant.data.length === 0) {
        plantId = deptId;
      } else {
        plantId = "";
      }
    } else {
      plantId = deptId;
    }
  }

  this.setData({
    organization_id: organizationId,
    ...(!plant ? { plant_id: plantId } : {}),
    created_at: new Date().toISOString().split("T")[0],
  });
};

const setPackingMode = async () => {
  const packingMode = this.getValue("packing_mode");
  if (packingMode === "Basic") {
    this.display(["table_hu.hu_quantity"]);
    this.hide(["table_hu.item_count", "table_hu.total_quantity"]);
  } else {
    this.hide(["table_hu.hu_quantity"]);
    this.display(["table_hu.item_count", "table_hu.total_quantity"]);
  }
};

// table_hu_source columns `hu_select` and `handling_unit_id` are visible by
// default in the form schema. This function walks each row and hides them
// on non-header (item) rows so they only appear on HU headers.
const applyHuSourceVisibility = async () => {
  const rows = this.getValue("table_hu_source") || [];
  if (rows.length === 0) return;

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].row_type !== "header") {
      await this.hide(`table_hu_source.${i}.handling_unit_id`);
    }
  }
};

const fetchPickingSetup = async (organizationId) => {
  try {
    const resPickingSetup = await db
      .collection("picking_setup")
      .where({ organization_id: organizationId })
      .get()
      .then((res) => {
        return res.data[0];
      });

    if (!resPickingSetup) {
      console.log("No picking setup found");
      return;
    }

    const pickingAfter = resPickingSetup.picking_after;

    if (pickingAfter === "Sales Order") {
      await this.hide(["gd_id"]);
    }
  } catch (error) {
    console.error(error);
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";
    const status = await this.getValue("packing_status");
    console.log("Debug", this.getValues());

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        // Add mode
        this.display(["draft_status"]);
        this.disabled("assigned_to", false);
        this.setData({
          created_by: this.getVarGlobal("nickname"),
        });

        setPlant(organizationId);

        await setPackingMode();
        await fetchPickingSetup(organizationId);
        break;

      case "Edit":
        if (status !== "Draft") {
          this.hide(["button_save_as_draft"]);
          await fetchPickingSetup(organizationId);
        }
        await disabledField(status);
        await showStatusHTML(status);
        await setPackingMode();
        break;

      case "View":
        await showStatusHTML(status);
        this.hide([
          "button_save_as_draft",
          "button_created",
          "button_completed",
        ]);
        await setPackingMode();
        break;
    }

    await this.triggerEvent("PackingRecomputeSource");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

// Per-row visibility for table_hu_source needs the table data to be loaded
// before display/hide can target specific rows. Run after a delay.
setTimeout(async () => {
  if (this.isAdd) return;
  await applyHuSourceVisibility();
}, 500);

setTimeout(async () => {
  if (!this.isAdd) return;
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("packing_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }

  const optionsData = this.getOptionData("packing_no_type") || [];
  const data = getDefaultItem(optionsData);
  if (data) {
    this.setData({ packing_no_type: data.value });
  }
}, 500);
