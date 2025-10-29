// Helper functions
const generatePrefix = (prefixData) => {
  const now = new Date();
  let prefixToShow = prefixData.current_prefix_config;

  prefixToShow = prefixToShow.replace("prefix", prefixData.prefix_value);
  prefixToShow = prefixToShow.replace("suffix", prefixData.suffix_value);
  prefixToShow = prefixToShow.replace(
    "month",
    String(now.getMonth() + 1).padStart(2, "0")
  );
  prefixToShow = prefixToShow.replace(
    "day",
    String(now.getDate()).padStart(2, "0")
  );
  prefixToShow = prefixToShow.replace("year", now.getFullYear());
  prefixToShow = prefixToShow.replace(
    "running_number",
    String(prefixData.running_number).padStart(prefixData.padding_zeroes, "0")
  );

  return prefixToShow;
};

const checkUniqueness = async (generatedPrefix, organizationId) => {
  const existingDoc = await db
    .collection("transfer_order")
    .where({ to_id: generatedPrefix, organization_id: organizationId })
    .get();

  return !existingDoc.data || existingDoc.data.length === 0;
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
      "Could not generate a unique Transfer Order number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Transfer Order",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();

  if (!prefixEntry.data || prefixEntry.data.length === 0) {
    return null;
  } else {
    if (prefixEntry.data[0].is_active === 0) {
      this.disabled(["to_id"], false);
    } else {
      this.disabled(["to_id"], true);
    }
  }

  return prefixEntry.data[0];
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  if (prefixData && prefixData.is_active === 1) {
    const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);
    this.setData({ to_id: prefixToShow });
  }
};

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
      true
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
        (field) => `table_picking_items.${index}.${field}`
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
        await this.display("table_picking_items.select_serial_number");
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
            picking.item_code || picking.id
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
              `No valid serial numbers found for item at index ${index}`
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
              `No valid serial numbers after processing for item at index ${index}`
            );
            continue;
          }

          console.log(
            `Setting ${serialNumbers.length} serial numbers for item at index ${index}:`,
            serialNumbers
          );

          // Set option data for select dropdown
          await this.setOptionData(
            [`table_picking_items.${index}.select_serial_number`],
            serialNumbers
          );

          // Set the actual data
          await this.setData({
            [`table_picking_items.${index}.select_serial_number`]:
              serialNumbers,
          });

          // Disable picked_qty field for serialized items
          await this.disabled(
            [`table_picking_items.${index}.picked_qty`],
            true
          );

          console.log(
            `Successfully set serial numbers for item at index ${index}`
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
    gdIDs.map((gdId) => db.collection("goods_delivery").doc(gdId).get())
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
            true
          );
        }, 100);
      }
    }
  }
};

const refDocTypePickingPlan = async () => {
  const refDocType = await this.getValue("ref_doc_type");
  if (refDocType === "Picking Plan") {
    await this.hide(["gd_no", "delivery_no"]);
  }
};

// Main execution function
(async () => {
  try {
    let pageStatus = "";
    const status = await this.getValue("to_status");

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

    switch (pageStatus) {
      case "Add":
        // Add mode
        this.display(["draft_status"]);
        this.disabled("assigned_to", false);
        this.setData({
          "table_picking_items.picked_qty": 0,
          created_by: this.getVarGlobal("nickname"),
          movement_type: "Picking",
          ref_doc_type: "Goods Delivery",
        });

        await setPlant(organizationId);

        const convertFromGD = this.getValue("plant_id");

        if (convertFromGD) {
          await viewSerialNumber();
          await setSerialNumber();
        }
        await setPrefix(organizationId);
        await refDocTypePickingPlan();
        break;

      case "Edit":
        if (
          status !== "Completed" ||
          status !== "Created" ||
          status !== "In Progress"
        ) {
          await getPrefixData(organizationId);
        }
        this.setData({
          "table_picking_items.picked_qty": 0,
          "table_picking_items.remark": "",
        });
        if (status !== "Draft") {
          this.hide(["gd_no"]);
          this.hide(["button_save_as_draft"]);
          this.display(["delivery_no"]);

          if (status !== "Created") {
            this.hide(["button_created"]);
          }
        }
        await disabledField(status);
        await showStatusHTML(status);
        await disabledPickedQtyField();
        await viewSerialNumber();
        await setSerialNumber();
        console.log(
          "table_picking_item onMounted",
          this.getValue("table_picking_items")
        );
        await refDocTypePickingPlan();
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
        await refDocTypePickingPlan();
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
