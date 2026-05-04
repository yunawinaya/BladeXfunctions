const showStatusHTML = (status) => {
  const statusMap = {
    Draft: "draft_status",
    Created: "created_status",
    Packed: "packed_status",
    Cancelled: "cancel_status",
  };

  if (statusMap[status]) {
    this.display([statusMap[status]]);
  }
};

const CONFIG = {
  fields: {
    buttons: ["button_save_as_draft", "button_created"],
    hide: ["page_status", "hu_status"],
    conditional: ["customer_id", "parent_hu_id", "packing_id", "closed_by"],
  },
  buttonConfig: {
    Draft: ["button_save_as_draft", "button_created"],
  },
};

const configureFields = () => {
  this.hide(CONFIG.fields.hide);
};

const configureButtons = (pageStatus, huStatus) => {
  this.hide(CONFIG.fields.buttons);

  if (pageStatus === "Add" || huStatus === "Draft") {
    this.display(CONFIG.buttonConfig.Draft);
  }
};

const showConditionalFields = (data) => {
  if (data.customer_id) this.display(["customer_id"]);
  if (data.closed_by) this.display(["closed_by"]);
  if (data.table_hu_items && data.table_hu_items.length > 0)
    this.display(["table_hu_items"]);
};

const editDisabledField = () => {
  this.disabled(
    [
      "plant_id",
      "organization_id",
      "customer_id",
      "parent_hu_id",
      "handling_no",
      "handling_no_type",
      "hu_material_id",
      "hu_type",
      "hu_quantity",
      "hu_uom",
      "storage_location_id",
      "location_id",
      "item_count",
      "total_quantity",
      "gross_weight",
      "net_weight",
      "net_volume",
      "ref_doc",
      "remark",
      "packing_id",
      "closed_by",
      "table_hu_items",
      "table_hu_items.material_id",
      "table_hu_items.material_name",
      "table_hu_items.material_desc",
      "table_hu_items.location_id",
      "table_hu_items.batch_id",
      "table_hu_items.material_uom",
      "table_hu_items.quantity",
    ],
    true,
  );
};

const setPlant = (organizationId, pageStatus) => {
  const currentDept = this.getVarSystem("deptIds").split(",")[0];
  const isSameDept = currentDept === organizationId;

  this.disabled("plant_id", !isSameDept);

  if (pageStatus === "Add" && !isSameDept) {
    this.setData({ plant_id: currentDept });
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
          storage_location_id: defaultStorageLocationID,
        });
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
    else if (this.isView) pageStatus = "View";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    switch (pageStatus) {
      case "Add":
        this.setData({
          organization_id: organizationId,
          page_status: pageStatus,
        });

        configureFields();
        configureButtons(pageStatus, null);
        this.display(["draft_status"]);

        const plantID = setPlant(organizationId, pageStatus);
        await setStorageLocation(plantID);
        break;

      case "View":
        configureFields();
        configureButtons(pageStatus, data.hu_status);
        showStatusHTML(data.hu_status);
        showConditionalFields(data);
        editDisabledField();
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
}, 500);

setTimeout(async () => {
  if (!this.isAdd) return;
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("handling_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("handling_no");
  const { options } = params;

  const optionsData = this.getOptionData("handling_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("handling_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    this.setData({
      handling_no_type: defaultData ? defaultData.value : -9999,
    });
  } else if (defaultData) {
    this.setData({ handling_no_type: defaultData.value });
  }
}, 200);
