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
    .collection("packing")
    .where({ packing_no: generatedPrefix, organization_id: organizationId })
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
      document_types: "Packing",
      is_deleted: 0,
      organization_id: organizationId,
    })
    .get();

  if (!prefixEntry.data || prefixEntry.data.length === 0) {
    return null;
  } else {
    if (prefixEntry.data[0].is_active === 0) {
      this.disabled(["packing_no"], false);
    } else {
      this.disabled(["packing_no"], true);
    }
  }

  return prefixEntry.data[0];
};

const setPrefix = async (organizationId) => {
  const prefixData = await getPrefixData(organizationId);

  if (prefixData && prefixData.is_active === 1) {
    const { prefixToShow } = await findUniquePrefix(prefixData, organizationId);
    this.setData({ packing_no: prefixToShow });
  }
};

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
  if (status === "Completed") {
    this.disabled(
      [
        "packing_status",
        "plant_id",
        "packing_no",
        "gd_id",
        "gd_no",
        "so_id",
        "so_no",
        "customer_id",
        "billing_address",
        "shipping_address",
        "packing_mode",
        "packing_location",
        "assigned_to",
        "created_by",
        "created_at",
        "organization_id",
        "ref_doc",
        "table_hu",
        "table_items",
        "remarks",
      ],
      true
    );

    this.hide(["button_save_as_draft", "button_created", "button_completed"]);

    // Disable table rows
    disableTableRows();
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

const viewSerialNumber = async () => {
  const table_items = this.getValue("table_items");
  if (table_items.length > 0) {
    for (const picking of table_items) {
      if (picking.is_serialized_item === 1) {
        await this.display([
          "table_items.select_serial_number",
          "table_items.serial_numbers",
        ]);
      }
    }
  }
};

const setPackingMode = async () => {
  const packingMode = this.getValue("packing_mode");
  if (packingMode === "Basic") {
    this.display(["table_hu.hu_quantity"]);
    this.hide([
      "table_hu.select_items",
      "table_hu.item_count",
      "table_hu.total_quantity",
    ]);
  } else {
    this.hide(["table_hu.hu_quantity"]);
    this.display([
      "table_hu.select_items",
      "table_hu.item_count",
      "table_hu.total_quantity",
    ]);
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
      await this.display(["so_id"]);
      await this.hide(["gd_id"]);
      await this.disabled(["so_id"], false);
    } else {
      await this.disabled(["so_id"], true);
      await this.disabled(["gd_id"], false);
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

        const convertFromGD = this.getValue("plant_id");

        if (convertFromGD) {
          await viewSerialNumber();
        }
        await setPrefix(organizationId);
        await setPackingMode();
        await fetchPickingSetup(organizationId);
        break;

      case "Edit":
        if (status !== "Completed" || status !== "Created") {
          await getPrefixData(organizationId);
          await fetchPickingSetup(organizationId);
        }
        if (status !== "Draft") {
          this.hide(["button_save_as_draft"]);
        }
        await disabledField(status);
        await showStatusHTML(status);
        await viewSerialNumber();
        await setPackingMode();
        break;

      case "View":
        await showStatusHTML(status);
        this.hide([
          "button_save_as_draft",
          "button_created",
          "button_completed",
        ]);
        await viewSerialNumber();
        await setPackingMode();
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
