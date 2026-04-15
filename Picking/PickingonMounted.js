// Helper functions
const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display(["draft_status"]);
      break;
    case "Created":
      this.display(["created_status"]);
      break;
    case "In Progress":
      this.display(["processing_status"]);
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
  if (status === "Completed") {
    this.disabled(
      [
        "to_status",
        "plant_id",
        "to_id",
        "movement_type",
        "ref_doc_type",
        "gd_no",
        "delivery_no",
        "so_no",
        "assigned_to",
        "created_by",
        "created_at",
        "organization_id",
        "ref_doc",
        "table_picking_items",
        "table_picking_records",
        "remarks",
      ],
      true,
    );

    this.hide([
      "button_save_as_draft",
      "button_inprogress",
      "button_completed",
    ]);

    // Disable table rows
    disableTableRows();
  } else {
    if (status === "Created") {
      this.hide(["button_save_as_draft"]);
    }
    this.disabled(["ref_doc"], false);
  }
};

const disableTableRows = () => {
  setTimeout(() => {
    const data = this.getValues();
    const rows = data.table_picking_items || [];

    rows.forEach((row, index) => {
      const fieldNames = Object.keys(row).filter((key) => key !== "picked_qty");

      const fieldsToDisable = fieldNames.map(
        (field) => `table_picking_items.${index}.${field}`,
      );

      this.disabled(fieldsToDisable, true);
    });
  }, 1000);
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

const viewSerialNumber = async () => {
  const table_picking_items = this.getValue("table_picking_items");
  const table_picking_records = this.getValue("table_picking_records");
  if (table_picking_items.length > 0) {
    for (const picking of table_picking_items) {
      if (picking.is_serialized_item === 1) {
        await this.display([
          "table_picking_items.select_serial_number",
          "table_picking_items.serial_numbers",
        ]);
      }
    }
  }
  if (table_picking_records.length > 0) {
    for (const picking of table_picking_records) {
      if (picking.serial_numbers !== "" && picking.serial_numbers !== null) {
        await this.display("table_picking_records.serial_numbers");
      }
    }
  }
};

const setSerialNumber = async () => {
  try {
    const table_picking_items = this.getValue("table_picking_items");

    // Check if table_picking_items exists and is an array
    if (
      !Array.isArray(table_picking_items) ||
      table_picking_items.length === 0
    ) {
      console.log("No picking items found or invalid data structure");
      return;
    }

    for (const [index, picking] of table_picking_items.entries()) {
      try {
        // Check if item is serialized
        if (picking.is_serialized_item === 1) {
          console.log(
            `Processing serialized item at index ${index}:`,
            picking.item_code || picking.id,
          );

          // Check if serial_numbers exists and is not empty
          if (
            !picking.serial_numbers ||
            picking.serial_numbers === null ||
            picking.serial_numbers === undefined ||
            typeof picking.serial_numbers !== "string" ||
            picking.serial_numbers.trim() === ""
          ) {
            console.warn(
              `No valid serial numbers found for item at index ${index}`,
            );
            continue;
          }

          console.log("Picking Serial Numbers", picking.serial_numbers);

          // Split and clean serial numbers
          const serialNumbers = picking.serial_numbers
            .split(",")
            .map((sn) => sn.trim())
            .filter((sn) => sn !== "");

          if (serialNumbers.length === 0) {
            console.warn(
              `No valid serial numbers after processing for item at index ${index}`,
            );
            continue;
          }

          console.log(
            `Setting ${serialNumbers.length} serial numbers for item at index ${index}:`,
            serialNumbers,
          );

          // Set option data for select dropdown
          await this.setOptionData(
            [`table_picking_items.${index}.select_serial_number`],
            serialNumbers,
          );

          // Set the actual data
          await this.setData({
            [`table_picking_items.${index}.select_serial_number`]:
              serialNumbers,
          });

          // Disable picked_qty field for serialized items
          await this.disabled(
            [`table_picking_items.${index}.picked_qty`],
            true,
          );

          console.log(
            `Successfully set serial numbers for item at index ${index}`,
          );
        }
      } catch (itemError) {
        console.error(`Error processing item at index ${index}:`, itemError);
        // Continue with next item instead of breaking the entire function
        continue;
      }
    }
  } catch (error) {
    console.error("Error in setSerialNumber function:", error);
    // Don't throw error to prevent breaking the entire onMounted flow
  }
};

const disabledPickedQtyField = async () => {
  const gdIDs = await this.getValue("gd_no");

  const resGD = await Promise.all(
    gdIDs.map((gdId) => db.collection("goods_delivery").doc(gdId).get()),
  );

  const gdData = resGD.map((gd) => gd.data[0]);
  const cancelledGD = gdData.filter((gd) => gd.picking_status === "Cancelled");
  const tablePickingItems = this.getValue("table_picking_items");
  if (tablePickingItems.length > 0) {
    for (const [index, picking] of tablePickingItems.entries()) {
      const cancelGD = cancelledGD.find((gd) => gd.id === picking.gd_id);
      console.log("cancelGD", cancelGD);
      if (picking.line_status === "Cancelled" || cancelGD) {
        setTimeout(async () => {
          this.disabled(
            [
              `table_picking_items.${index}.picked_qty`,
              `table_picking_items.${index}.remark`,
              `table_picking_items.${index}.select_serial_number`,
            ],
            true,
          );
        }, 100);
      }
    }
  }
};

const HU_HEADER_FIELDS = ["handling_unit_id", "hu_select"];

const createHeaderRows = async () => {
  const rows = this.getValue("table_picking_items") || [];
  if (rows.length === 0) return;

  if (rows.some((r) => r.row_type === "header")) return;

  const newRows = [];
  let lastHuId = null;

  for (const row of rows) {
    const huId = row.handling_unit_id;
    if (huId && huId !== lastHuId) {
      newRows.push({
        row_type: "header",
        handling_unit_id: huId,
        hu_select: 0,
      });
      lastHuId = huId;
    } else if (!huId) {
      lastHuId = null;
    }
    newRows.push({ ...row, row_type: "item" });
  }

  if (newRows.length !== rows.length) {
    await this.setData({ table_picking_items: newRows });
  }
};

const applyHUVisibility = async () => {
  const rows = this.getValue("table_picking_items") || [];
  if (rows.length === 0) return;

  const sampleItem = rows.find((r) => r.row_type !== "header");
  if (!sampleItem) return;

  const itemFields = Object.keys(sampleItem).filter(
    (k) => !HU_HEADER_FIELDS.includes(k) && k !== "row_type",
  );

  for (const [i, row] of rows.entries()) {
    if (row.row_type === "header") {
      for (const f of HU_HEADER_FIELDS) {
        await this.display(`table_picking_items.${i}.${f}`);
      }
      for (const f of itemFields) {
        await this.hide(`table_picking_items.${i}.${f}`);
      }
    }
  }
};

const PickingPlan = async () => {
  try {
    const pickingSetup = await db
      .collection("picking_setup")
      .where({
        plant_id: this.getValue("plant_id"),
        picking_required: 1,
      })
      .get();

    if (pickingSetup.data && pickingSetup.data.length > 0) {
      if (pickingSetup.data[0].picking_after === "Goods Delivery") {
        await this.display(["button_completed"]);
      } else if (pickingSetup.data[0].picking_after === "Sales Order") {
        await this.display(["to_validity_period", "to_no"]);
        await this.hide(["gd_no", "delivery_no"]);
      } else {
        await this.display(["button_completed"]);
      }
    }

    const isLoadingBay = pickingSetup.data[0].is_loading_bay;
    await this.setData({
      is_loading_bay: isLoadingBay,
    });
    if (isLoadingBay) {
      await this.display([
        "table_picking_items.storage_location",
        "table_picking_items.target_location",
      ]);
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";
    const status = await this.getValue("to_status");
    console.log("Debug", status, this.getValues());

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    console.log("pageStatus", pageStatus);
    await this.setData({ page_status: pageStatus });
    console.log("pageStatusData", this.getValue("page_status"));

    switch (pageStatus) {
      case "Add":
        // Add mode
        this.display(["draft_status"]);
        this.disabled("assigned_to", false);
        this.setData({
          page_status: pageStatus,
          created_by: this.getVarGlobal("nickname"),
          movement_type: "Picking",
        });

        await setPlant(organizationId);

        const convertFromGD = this.getValue("plant_id");

        if (convertFromGD) {
          await viewSerialNumber();
          await setSerialNumber();
        }
        await createHeaderRows();
        await applyHUVisibility();
        await PickingPlan();
        break;

      case "Edit":
        // this.setData({
        //   "table_picking_items.picked_qty": 0,
        //   "table_picking_items.remark": "",
        // });
        if (status !== "Draft") {
          this.hide(["gd_no", "button_save_as_draft", "button_created"]);
        }
        await disabledField(status);
        await showStatusHTML(status);
        await disabledPickedQtyField();
        await viewSerialNumber();
        await setSerialNumber();
        console.log(
          "table_picking_item onMounted",
          this.getValue("table_picking_items"),
        );
        await createHeaderRows();
        await applyHUVisibility();
        await PickingPlan();
        break;

      case "View":
        this.hide(["gd_no"]);
        this.display(["delivery_no"]);
        await showStatusHTML(status);
        this.hide([
          "button_save_as_draft",
          "button_created",
          "button_inprogress",
          "button_completed",
        ]);
        await viewSerialNumber();
        await createHeaderRows();
        await applyHUVisibility();
        await PickingPlan();
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();

setTimeout(async () => {
  if (!this.isAdd) return;
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("to_id_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }

  const optionsData = this.getOptionData("to_id_type") || [];
  const data = getDefaultItem(optionsData);
  if (data) {
    this.setData({ to_id_type: data.value });
  }
}, 500);
