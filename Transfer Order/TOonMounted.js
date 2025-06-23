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

    // Disable table rows
    disableTableRows();

    this.display(["goods_delivery_no"]);
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
  });
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
        if (
          status !== "Completed" ||
          status !== "Created" ||
          status !== "In Progress"
        ) {
          await getPrefixData(organizationId);
        }
        await disabledField(status);
        await showStatusHTML(status);
        break;

      case "View":
        await showStatusHTML(status);
        this.hide([
          "button_save_as_draft",
          "button_inprogress",
          "button_completed",
        ]);
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
