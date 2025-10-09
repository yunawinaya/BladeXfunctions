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
    .collection("transfer_order_putaway")
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
      "Could not generate a unique Putaway number after maximum attempts"
    );
  }

  return { prefixToShow, runningNumber };
};

const getPrefixData = async (organizationId) => {
  const prefixEntry = await db
    .collection("prefix_configuration")
    .where({
      document_types: "Transfer Order (Putaway)",
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
    default:
      break;
  }
};

const disabledField = async (status) => {
  switch (status) {
    case "Completed":
      this.disabled(
        [
          "to_status",
          "plant_id",
          "to_id",
          "movement_type",
          "ref_doc_type",
          "gr_no",
          "receiving_no",
          "supplier_id",
          "assigned_to",
          "created_by",
          "created_at",
          "organization_id",
          "ref_doc",
          "table_putaway_item",
          "table_putaway_records",
          "remarks",
        ],
        true
      );

      this.hide([
        "button_save_as_draft",
        "button_inprogress",
        "button_completed",
      ]);

      break;

    case "Created":
    case "In Progress":
      this.disabled(
        [
          "plant_id",
          "to_id",
          "movement_type",
          "ref_doc_type",
          "gr_no",
          "receiving_no",
          "supplier_id",
          "assigned_to",
          "created_by",
          "created_at",
        ],
        true
      );

      this.hide(["button_save_as_draft"]);
  }
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  console.log("JN Debugging", deptId, organizationId);
  let plantId = "";
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

  this.setData({
    organization_id: organizationId,
    plant_id: plantId,
    created_at: new Date().toISOString().split("T")[0],
    created_by: this.getVarGlobal("nickname"),
    movement_type: "Putaway",
  });
};

const showQINo = async () => {
  const data = this.getValues();

  if (data.qi_id && data.qi_id !== null && data.qi_id !== "") {
    this.display("quality_insp_no");
  }
};

const enabledTargetCategoryField = async () => {
  const putawayItem = this.getValue("table_putaway_item");

  setTimeout(() => {
    for (const [index, item] of putawayItem.entries()) {
      if (!item.qi_no || item.qi_no === null) {
        console.log("item qi no", item.qi_no);
        this.disabled(
          [`table_putaway_item.${index}.target_inv_category`],
          false
        );
      }
    }
  }, 100);
};

const viewSerialNumber = async () => {
  const table_putaway_item = this.getValue("table_putaway_item");
  const table_putaway_records = this.getValue("table_putaway_records");
  if (table_putaway_item.length > 0) {
    for (const putaway of table_putaway_item) {
      if (
        putaway.is_serialized_item === 1 &&
        putaway.serial_numbers !== "" &&
        putaway.serial_numbers !== undefined
      ) {
        console.log("serial numbers", putaway.serial_numbers);
        await this.display("table_putaway_item.select_serial_number");
      }
    }
  }
  if (table_putaway_records.length > 0) {
    for (const putaway of table_putaway_records) {
      if (putaway.serial_numbers !== "" && putaway.serial_numbers !== null) {
        await this.display("table_putaway_records.serial_numbers");
      }
    }
  }
};

const setSerialNumber = async () => {
  try {
    const table_putaway_item = this.getValue("table_putaway_item");

    // Check if table_putaway_item exists and is an array
    if (!Array.isArray(table_putaway_item) || table_putaway_item.length === 0) {
      console.log("No putaway items found or invalid data structure");
      return;
    }

    for (const [index, putaway] of table_putaway_item.entries()) {
      try {
        // Check if item is serialized
        if (putaway.is_serialized_item === 1) {
          console.log(
            `Processing serialized item at index ${index}:`,
            putaway.item_code || putaway.id
          );

          // Check if serial_numbers exists and is not empty
          if (
            !putaway.serial_numbers ||
            putaway.serial_numbers === null ||
            putaway.serial_numbers === undefined ||
            typeof putaway.serial_numbers !== "string" ||
            putaway.serial_numbers.trim() === ""
          ) {
            console.warn(
              `No valid serial numbers found for item at index ${index}`
            );
            continue;
          }

          // Split and clean serial numbers
          const serialNumbers = putaway.serial_numbers
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
            [`table_putaway_item.${index}.select_serial_number`],
            serialNumbers
          );

          // Set the actual data
          await this.setData({
            [`table_putaway_item.${index}.select_serial_number`]: serialNumbers,
          });

          // Disable putaway_qty field for serialized items
          await this.disabled(
            [`table_putaway_item.${index}.putaway_qty`],
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

        await setPlant(organizationId);
        await setPrefix(organizationId);
        break;

      case "Edit":
        if (status === "Draft") {
          await getPrefixData(organizationId);
        } else {
          this.hide(["gr_no"]);
          this.display(["receiving_no"]);

          if (status === "Created" || status === "In Progress") {
            console.log("status", status);
            const tablePutawayItem = this.getValue("table_putaway_item");
            for (const putaway of tablePutawayItem) {
              putaway.putaway_qty = 0;
            }

            this.setData({ table_putaway_item: tablePutawayItem });
            setTimeout(() => {
              this.triggerEvent("func_getPutawayStrategy", {});
            }, 100);
          }
        }
        await enabledTargetCategoryField();
        await disabledField(status);
        await showStatusHTML(status);
        await showQINo();
        await viewSerialNumber();
        setTimeout(() => {
          setSerialNumber();
        }, 300);
        break;

      case "View":
        this.hide(["gr_no"]);
        this.display(["receiving_no"]);
        await showStatusHTML(status);
        this.hide([
          "button_save_as_draft",
          "button_inprogress",
          "button_completed",
        ]);
        await showQINo();
        await viewSerialNumber();
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
