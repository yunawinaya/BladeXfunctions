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

const editDisabledField = () => {
  this.disabled(
    [
      "issue_date",
      "handling_no",
      "movement_type",
      "movement_reason",
      "issued_by",
      "plant_id",
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
            location_id: resBinLocation.data[0].id,
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

        this.display(["draft_status", "button_save_as_draft"]);
        this.hide(CONFIG.fields.hide);

        const plantID = setPlant(organizationId, pageStatus);
        configureFields();
        configureButtons(pageStatus, null);
        await setStorageLocation(plantID);
        break;

      case "View":
        configureFields();
        configureButtons(pageStatus, data.stock_movement_status);
        this.hide(CONFIG.fields.hide);

        showStatusHTML(data.stock_movement_status);
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
}, 500);

setTimeout(async () => {
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
    if (this.isAdd) {
      this.setData({
        handling_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ handling_no_type: defaultData.value });
    }
  }
}, 200);
