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
        true,
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
        true,
      );

      this.hide(["button_save_as_draft"]);
  }
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";
  if (deptId === organizationId) {
    const resPlant = await db
      .collection("blade_dept")
      .where({ parent_id: deptId })
      .get();

    if (!resPlant.data.length > 0) {
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
  const qiId = this.getValue("qi_id");

  if (qiId && qiId !== null && qiId !== "") {
    this.display("quality_insp_no");
  }
};

// target_inv_category's column expression; a row state is set only where it differs (each path copies the state map)
const targetCategoryColumnDisabled = (item) =>
  Boolean(item.item_bundle_id && !item.parent_fm_key);

const enabledTargetCategoryField = async () => {
  const putawayItem = this.getValue("table_putaway_item");

  // The bundle row carries the bundle id and no item code. It holds no stock,
  // so it has no inventory category — that belongs to the items under it.
  const isBundleParentRow = (item) =>
    Boolean(item.item_bundle_id) && !item.item_code;

  setTimeout(() => {
    const toDisable = [];
    const toEnable = [];

    const applyRow = (item, path) => {
      let state;
      if (isBundleParentRow(item)) {
        state = true;
      } else if (!item.qi_no || item.qi_no === null) {
        state = false;
      } else {
        return;
      }

      if (state !== targetCategoryColumnDisabled(item)) {
        (state ? toDisable : toEnable).push(`${path}.target_inv_category`);
      }
    };

    for (const [index, item] of putawayItem.entries()) {
      const path = `table_putaway_item.${index}`;

      applyRow(item, path);

      // A bundle's items are rows of the tree, not of table_putaway_item, so
      // they are reached through their parent.
      const bundleChildren = Array.isArray(item.children) ? item.children : [];

      for (const [childIndex, child] of bundleChildren.entries()) {
        applyRow(child, `${path}.children.${childIndex}`);
      }
    }

    if (toDisable.length > 0) this.disabled(toDisable, true);
    if (toEnable.length > 0) this.disabled(toEnable, false);
  }, 100);
};

const viewSerialNumber = async () => {
  const table_putaway_item = this.getValue("table_putaway_item") || [];
  const table_putaway_records = this.getValue("table_putaway_records") || [];

  if (
    table_putaway_item.some(
      (putaway) =>
        putaway.is_serialized_item === 1 &&
        putaway.serial_numbers !== "" &&
        putaway.serial_numbers !== undefined,
    )
  ) {
    await this.display("table_putaway_item.select_serial_number");
  }

  if (
    table_putaway_records.some(
      (putaway) =>
        putaway.serial_numbers !== "" && putaway.serial_numbers !== null,
    )
  ) {
    await this.display("table_putaway_records.serial_numbers");
  }
};

// serial rows only: one write of the selections (each key still runs onChange_selectSN) and one disabled() call
const setSerialNumber = async () => {
  try {
    const table_putaway_item = this.getValue("table_putaway_item");

    if (!Array.isArray(table_putaway_item) || table_putaway_item.length === 0) {
      console.log("No putaway items found or invalid data structure");
      return;
    }

    const selections = {};
    const qtyPaths = [];
    const optionCalls = [];

    for (const [index, putaway] of table_putaway_item.entries()) {
      if (putaway.is_serialized_item !== 1) continue;

      if (
        !putaway.serial_numbers ||
        typeof putaway.serial_numbers !== "string" ||
        putaway.serial_numbers.trim() === ""
      ) {
        console.warn(`No valid serial numbers found for item at index ${index}`);
        continue;
      }

      const serialNumbers = putaway.serial_numbers
        .split(",")
        .map((sn) => sn.trim())
        .filter((sn) => sn !== "");

      if (serialNumbers.length === 0) {
        console.warn(
          `No valid serial numbers after processing for item at index ${index}`,
        );
        continue;
      }

      optionCalls.push(
        this.setOptionData(
          [`table_putaway_item.${index}.select_serial_number`],
          serialNumbers,
        ),
      );
      selections[`table_putaway_item.${index}.select_serial_number`] =
        serialNumbers;
      qtyPaths.push(`table_putaway_item.${index}.putaway_qty`);
    }

    if (qtyPaths.length === 0) return;

    await Promise.all(optionCalls);
    await this.setData(selections);
    this.disabled(qtyPaths, true);
  } catch (error) {
    console.error("Error in setSerialNumber function:", error);
    // Don't throw error to prevent breaking the entire onMounted flow
  }
};

// rows with a handling unit are disabled by button_split's own column expression

const setDocType = async (plantId) => {
  if (plantId) {
    await this.disabled(["ref_doc_type", "gr_no"], false);
    await this.setData({ ref_doc_type: "Goods Receiving" });
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
        await setDocType(this.getValue("plant_id"));
        break;

      case "Edit":
        this.setData({ previous_status: status });
        if (status !== "Draft") {
          this.hide(["gr_no"]);
          this.display(["receiving_no"]);

          if (status === "Created" || status === "In Progress") {
            console.log("status", status);
            const tablePutawayItem = this.getValue("table_putaway_item");
            // Flat: a bundle's items are rows in their own right and hold a
            // putaway_qty of their own. Resetting only the top level left last
            // session's quantities on them, and because the completion path skips
            // the bundle row by design nothing objected -- the stale quantities
            // simply booked real inventory again on the next Complete.
            for (const putaway of tablePutawayItem) {
              putaway.putaway_qty = 0;

              for (const child of (Array.isArray(putaway.children) ? putaway.children : [])) {
                child.putaway_qty = 0;
              }
            }

            this.setData({ table_putaway_item: tablePutawayItem });
            setTimeout(() => {
              this.triggerEvent("func_getPutawayStrategy", {});
            }, 100);

            // Putaway Completion V2: an open background completion hides the save buttons
            this.triggerEvent("pwV2_onClick_completed", { pwv2_mode: "STATUS_ON_OPEN" });
          }
        }
        this.getComponent("table_putaway_item")?.hideChildRecord();

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

setTimeout(async () => {
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
  var params = this.getComponent("to_id");
  const { options } = params;

  const optionsData = this.getOptionData("to_id_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("to_id_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        to_id_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ to_id_type: defaultData.value });
    }
  }
}, 200);
