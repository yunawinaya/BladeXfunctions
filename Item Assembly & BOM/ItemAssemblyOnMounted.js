const showStatusHTML = (status) => {
  const statusMap = {
    Issued: "issued_status",
    Completed: "completed_status",
    "Fully Posted": "fullyposted_status",
  };
  if (statusMap[status]) {
    this.display([statusMap[status]]);
  }
};

const EDIT_DISABLED_FIELDS = [
  "issuing_operation_faci",
  "stock_movement_no",
  "stock_movement_no_type",
  "item_id",
  "item_name",
  "item_desc",
  "item_qty",
  "item_uom",
  "issued_by",
  "project_id",
  "batch_no",
  "manufacturing_date",
  "expired_date",
  "storage_location_id",
  "location_id",
  "item_assembly_date",
  "reference_documents",
  "net_weight",
  "gross_weight",
  "remarks",
];

// Mirrors MSI: a plant-level login can only issue from its own plant, so the
// field is fixed to it and locked; an org-level login picks one.
const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];
  const isSameDept = currentDept === organizationId;
  const isNew = pageStatus === "Add" || pageStatus === "Clone";

  this.disabled(["issuing_operation_faci"], !isSameDept);

  if (isNew && !isSameDept) {
    this.setData({ issuing_operation_faci: currentDept });
    this.disabled(["stock_movement"], false);
    // Reuse the plant handler so the storage location and bin defaults are
    // resolved in exactly one place.
    this.triggerEvent("onChange_Plant", { value: currentDept });
  } else if (isNew && isSameDept) {
    this.disabled(["stock_movement"], true);
  }

  return currentDept;
};

(async () => {
  try {
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
    const status = this.getValue("item_assembly_status");

    switch (pageStatus) {
      case "Add":
      case "Clone":
        this.setData({
          organization_id: organizationId,
          issued_by: this.getVarGlobal("nickname"),
          item_assembly_date: new Date().toISOString().split("T")[0],
        });
        // The status badge stays defined for later use, but a new assembly has
        // no status yet, so nothing is shown on Add.
        this.display(["button_completed", "comp_post_button"]);

        setPlant(organizationId, pageStatus);
        break;

      case "Edit":
        showStatusHTML(status);
        this.disabled(EDIT_DISABLED_FIELDS, true);

        if (status === "Completed") {
          this.display(["button_post"]);
          this.disabled(["stock_movement"], true);
        } else {
          this.display(["button_completed", "comp_post_button"]);
        }
        break;

      case "View":
        showStatusHTML(status);
        this.disabled(EDIT_DISABLED_FIELDS.concat(["stock_movement"]), true);
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

setTimeout(async () => {
  if (!this.isAdd && !this.isCopy) return;

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

  const params = this.getComponent("stock_movement_no");
  const { options } = params;
  const optionsData = this.getOptionData("stock_movement_no_type") || [];
  const defaultData = getDefaultItem(optionsData);

  if (options?.canManualInput) {
    if (!optionsData.some((option) => option.value === -9999)) {
      this.setOptionData("stock_movement_no_type", [
        { label: "Manual Input", value: -9999 },
        ...optionsData,
      ]);
    }
    this.setData({
      stock_movement_no_type: defaultData ? defaultData.value : -9999,
    });
  } else if (defaultData) {
    this.setData({ stock_movement_no_type: defaultData.value });
  }
}, 200);
