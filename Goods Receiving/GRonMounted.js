const displayAddress = async () => {
  if (
    this.getValue("gr_billing_name") ||
    this.getValue("gr_billing_cp") ||
    this.getValue("gr_billing_address") ||
    this.getValue("gr_shipping_address")
  ) {
    this.display("address_grid");
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

    case "Received":
      this.display(["received_status"]);
      break;

    case "Completed":
      this.display(["completed_status"]);
      break;
  }
};

const isViewMode = async () => {
  this.hide([
    "link_billing_address",
    "link_shipping_address",
    "button_save_as_draft",
    "button_save_as_comp",
    "button_completed",
  ]);
};

const disabledEditField = async (status) => {
  if (status === "Draft") {
    // Draft status: Full editing allowed
    // (enabled is the batch column's own default except on bundle lines)
    const batchPaths = [];
    this.getValue("table_gr").forEach((gr, index) => {
      if (gr.item_id && gr.item_bundle_id) {
        if (
          !gr.item_batch_no &&
          gr.item_batch_no !== "Auto-generated batch number" &&
          gr.item_batch_no !== "-"
        ) {
          batchPaths.push(`table_gr.${index}.item_batch_no`);
        }
      }
    });
    if (batchPaths.length > 0) this.disabled(batchPaths, false);
    this.disabled("reference_doc", false);
  } else if (status === "Created") {
    // Created status: Limited editing allowed (can re-save or complete)

    // Lock these header fields
    this.disabled(
      [
        "gr_status",
        "organization_id",
        "purchase_order_number",
        "supplier_name",
        "supplier_contact_person",
        "supplier_contact_number",
        "supplier_email",
        "plant_id",
      ],
      true,
    );

    // Allow editing these fields
    this.disabled(
      [
        "gr_no",
        "gr_received_by",
        "gr_date",
        "table_gr",
        "reference_doc",
        "ref_no_1",
        "ref_no_2",
        "assigned_to",
        "gr_billing_name",
        "gr_billing_cp",
        "gr_billing_address",
        "gr_shipping_address",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "billing_address_city",
        "shipping_address_city",
        "billing_postal_code",
        "shipping_postal_code",
        "billing_address_state",
        "shipping_address_state",
        "billing_address_country",
        "shipping_address_country",
      ],
      false,
    );

    // Enable batch number editing where applicable
    // (enabled is the batch column's own default except on bundle lines)
    const batchPaths = [];
    this.getValue("table_gr").forEach((gr, index) => {
      if (
        gr.item_id &&
        gr.item_bundle_id &&
        gr.item_batch_no !== "-" &&
        gr.item_batch_no !== "Auto-generated batch number"
      ) {
        batchPaths.push(`table_gr.${index}.item_batch_no`);
      }
    });
    if (batchPaths.length > 0) this.disabled(batchPaths, false);

    // Show appropriate buttons for Created status
    this.hide(["button_save_as_draft", "button_completed"]);
    this.display(["button_save_as_created", "button_save_as_comp"]);
  } else {
    // Received or Completed status: Full disable
    this.disabled(
      [
        "gr_status",
        "organization_id",
        "purchase_order_number",
        "gr_billing_name",
        "gr_billing_cp",
        "gr_billing_address",
        "gr_shipping_address",
        "supplier_name",
        "supplier_contact_person",
        "supplier_contact_number",
        "supplier_email",
        "plant_id",
        "gr_no",
        "gr_received_by",
        "gr_date",
        "table_gr",
        "billing_address_line_1",
        "billing_address_line_2",
        "billing_address_line_3",
        "billing_address_line_4",
        "shipping_address_line_1",
        "shipping_address_line_2",
        "shipping_address_line_3",
        "shipping_address_line_4",
        "billing_address_city",
        "shipping_address_city",
        "billing_postal_code",
        "shipping_postal_code",
        "billing_address_state",
        "shipping_address_state",
        "billing_address_country",
        "shipping_address_country",
        "reference_doc",
        "ref_no_1",
        "ref_no_2",
      ],
      true,
    );

    this.hide([
      "link_billing_address",
      "link_shipping_address",
      "button_save_as_draft",
      "button_save_as_created",
      "button_save_as_comp",
      "button_completed",
    ]);

    if (status === "Received") {
      this.display(["button_completed"]);
    }
  }
};

const setPlant = async (organizationId) => {
  const deptId = this.getVarSystem("deptIds").split(",")[0];
  let plantId = "";
  const hasPlant = this.getValue("plant_id");

  if (!hasPlant) {
    if (deptId === organizationId) {
      const resPlant = await db
        .collection("blade_dept")
        .where({ parent_id: deptId })
        .get();

      if (!resPlant || resPlant.data.length === 0) {
        plantId = deptId;
      } else {
        plantId = "";
        this.disabled("table_gr", true);
      }
    } else {
      plantId = deptId;
    }
  }
  console.log(hasPlant, "hasPlant");
  this.setData({
    organization_id: organizationId,
    ...(!hasPlant ? { plant_id: plantId } : {}),
    gr_received_by: this.getVarGlobal("nickname"),
  });
};

const fetchReceivedQuantity = async () => {
  const tableGR = this.getValue("table_gr") || [];
  const status = this.getValue("gr_status");
  const currentGRNo = this.getValue("gr_no");

  // One query per 500 PO lines instead of one per GR line.
  const poLineIds = [
    ...new Set(
      tableGR
        .map((item) => item.po_line_item_id)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const idChunks = [];
  for (let i = 0; i < poLineIds.length; i += 500) {
    idChunks.push(poLineIds.slice(i, i + 500));
  }

  const resPOLineData = await Promise.all(
    idChunks.map((ids) =>
      db
        .collection("purchase_order_2ukyuanr_sub")
        .filter(new Filter().in("id", ids).build())
        .get(),
    ),
  );

  const poLineById = new Map();
  resPOLineData.forEach((response) => {
    (response?.data || []).forEach((line) =>
      poLineById.set(String(line.id), line),
    );
  });

  const updatedTableGR = await Promise.all(
    tableGR.map(async (item) => {
      const poLine = item.po_line_item_id
        ? poLineById.get(String(item.po_line_item_id))
        : undefined;
      const orderQty = poLine ? poLine.quantity || 0 : 0;
      const receivedQty = poLine ? poLine.received_qty || 0 : 0;

      let initialReceivedQty = receivedQty; // Only count Received GRs by default
      let toReceivedQty = orderQty - receivedQty;

      // Special handling when editing a Created GR
      if (status === "Created" && currentGRNo) {
        // When editing Created GR, ignore other Created GRs in the form
        // Warnings only appear when saving (not in form display)

        // initial_received_qty = ONLY received_qty from PO (Received GRs only)
        initialReceivedQty = receivedQty;
        // to_received_qty = orderQty - receivedQty - current GR qty
        const currentGRQty = item.received_qty || 0;
        toReceivedQty = orderQty - receivedQty - currentGRQty;
      }

      return {
        ...item,
        initial_received_qty: initialReceivedQty,
        to_received_qty: toReceivedQty,
      };
    }),
  );

  await this.setData({ table_gr: updatedTableGR });
};

const viewSerialNumber = async () => {
  const tableGR = this.getValue("table_gr");
  if (tableGR.some((gr) => gr.is_serialized_item === 1)) {
    this.display(`table_gr.select_serial_number`);
  }
};

const viewBaseQty = async () => {
  const tableGR = this.getValue("table_gr");
  if (tableGR.some((gr) => gr.item_uom !== gr.base_item_uom)) {
    this.display([
      "table_gr.ordered_qty_uom",
      "table_gr.base_ordered_qty",
      "table_gr.base_ordered_qty_uom",
      "table_gr.to_received_qty_uom",
      "table_gr.base_received_qty_uom",
      "table_gr.base_received_qty",
      "table_gr.base_item_uom",
    ]);
  }
};

const displayAssignedTo = async () => {
  const plant = await this.getValue("plant_id");

  const resPutAwaySetup = await db
    .collection("putaway_setup")
    .where({
      plant_id: plant,
      is_deleted: 0,
      movement_type: "Good Receiving",
      putaway_required: 1,
    })
    .get();

  setTimeout(() => {
    if (resPutAwaySetup && resPutAwaySetup.data.length > 0) {
      console.log("resPutaway", resPutAwaySetup.data);
      this.display("assigned_to");
    } else {
      this.hide("assigned_to");
    }
  }, 30);
};

const hideSerialNumberRecordTab = () => {
  setTimeout(() => {
    const tableSerialNumber = this.getValue("table_sn_records");
    if (!tableSerialNumber || tableSerialNumber.length === 0) {
      const tabSelector =
        '.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-serial_number_records[tabindex="-1"][aria-selected="false"]';
      const tab = document.querySelector(tabSelector);

      if (tab) {
        tab.style.display = "none";
      } else {
        const fallbackTab = document.querySelector(
          '.el-drawer[role="dialog"] .el-tabs__item#tab-serial_number_records',
        );
        if (fallbackTab) {
          fallbackTab.style.display = "none";
        } else {
          console.log("Completion tab not found");
        }
      }

      const inactiveTabSelector =
        '.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-serial_number_records)';
      const inactiveTab = document.querySelector(inactiveTabSelector);
      if (inactiveTab) {
        inactiveTab.setAttribute("aria-disabled", "true");
        inactiveTab.classList.add("is-disabled");
      }
    }
  }, 10); // Small delay to ensure DOM is ready
};

const displayManufacturingAndExpiredDate = async (status, pageStatus) => {
  const tableGR = this.getValue("table_gr");
  if (tableGR.length === 0) return;
  if (tableGR.some((item) => item.item_batch_no !== "-")) {
    this.display(["table_gr.manufacturing_date", "table_gr.expired_date"]);
  }
  // The date columns already disable themselves on "-" lines; only bundle
  // lines need an explicit state.
  if ((pageStatus === "Edit" || pageStatus === "Add") && status === "Draft") {
    const enablePaths = [];
    const disablePaths = [];
    tableGR.forEach((item, index) => {
      if (!item.item_bundle_id) return;
      (item.item_batch_no !== "-" ? enablePaths : disablePaths).push(
        `table_gr.${index}.manufacturing_date`,
        `table_gr.${index}.expired_date`,
      );
    });
    if (enablePaths.length > 0) this.disabled(enablePaths, false);
    if (disablePaths.length > 0) this.disabled(disablePaths, true);
  }
};

const disabledItemBundleFields = async () => {
  // The bundle row carries the bundle id and no item of its own; a bundle's
  // items carry the bundle id and an item. Split children are matched by
  // neither, so their fields are left exactly as the split logic set them.
  const isBundleParentRow = (row) =>
    Boolean(row.item_bundle_id) && !row.item_id;
  const isBundleChildRow = (row) =>
    Boolean(row.item_bundle_id) && Boolean(row.item_id);

  // Behind func_processGRLineItem's own 50ms row pass, which re-enables these
  // fields row by row — and reading the table only once it has run.
  setTimeout(async () => {
    const tableGR = this.getValue("table_gr") || [];
    const paths = [];

    for (const [index, gr] of tableGR.entries()) {
      // The bundle row holds no stock and has no batch of its own, so neither
      // date applies to it.
      if (isBundleParentRow(gr)) {
        paths.push(
          `table_gr.${index}.manufacturing_date`,
          `table_gr.${index}.expired_date`,
        );
      }

      const bundleChildren = Array.isArray(gr.children) ? gr.children : [];

      // A bundle's items take their quantity from the bundle row's, at the ratio
      // the bundle was built with, so it is never typed in directly.
      for (const [childIndex, child] of bundleChildren.entries()) {
        if (!isBundleChildRow(child)) continue;

        paths.push(
          `table_gr.${index}.children.${childIndex}.received_qty`,
          `table_gr.${index}.children.${childIndex}.base_received_qty`,
        );
      }
    }

    if (paths.length > 0) this.disabled(paths, true);
  }, 150);
};

const checkAccIntegrationType = async (organizationId) => {
  if (organizationId) {
    const resAI = await db
      .collection("accounting_integration")
      .where({ organization_id: organizationId })
      .get();

    if (resAI && resAI.data.length > 0) {
      const aiData = resAI.data[0];
      this.setData({ acc_integration_type: aiData.acc_integration_type });
    }
  }
};

(async () => {
  try {
    const status = await this.getValue("gr_status");

    const pageStatus = this.isAdd
      ? "Add"
      : this.isEdit
        ? "Edit"
        : this.isView
          ? "View"
          : (() => {
              throw new Error("Invalid page status");
            })();

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    this.setData({ page_status: pageStatus });
    this.getComponent("table_gr")?.hideChildRecord();

    switch (pageStatus) {
      case "Add":
        this.setData({ gr_date: new Date().toISOString().split("T")[0] });
        this.display(["draft_status"]);
        this.hide("button_completed");
        await setPlant(organizationId);
        await checkAccIntegrationType(organizationId);
        await hideSerialNumberRecordTab();
        if (this.getValue("plant_id")) {
          this.disabled("reference_doc", false);
          console.log("trigger func_processGRLineItem");
          await this.triggerEvent("func_processGRLineItem");
          await this.triggerEvent("onChange_Supplier");
        }

        await disabledItemBundleFields();

        break;

      case "Edit":
        await disabledEditField(status);
        await displayAddress();
        await showStatusHTML(status);
        await fetchReceivedQuantity();
        await viewSerialNumber();
        await viewBaseQty();
        await displayAssignedTo();
        await checkAccIntegrationType(organizationId);
        await hideSerialNumberRecordTab();
        await displayManufacturingAndExpiredDate(status, pageStatus);
        if (status === "Draft" || status === "Created") {
          await this.triggerEvent("onChange_plant");
          this.hide("button_completed");
        } else {
          this.disabled("assigned_to", true);
        }

        const fromConvert = this.getValue("from_convert");
        this.setData({ previous_status: status });
        if (fromConvert === "Yes") {
          // Saved lines are kept; only lines never enriched are filled in.
          const hasNewLines = (this.getValue("table_gr") || []).some(
            (gr) => !gr.inspection_required,
          );
          console.log("trigger func_processGRLineItem", hasNewLines);
          await this.triggerEvent("func_processGRLineItem", {
            newRowsOnly: true,
          });
          if (hasNewLines) {
            await this.triggerEvent("onChange_Supplier");
          }
        }

        await disabledItemBundleFields();
        break;

      case "View":
        await displayAddress();
        await showStatusHTML(status);
        await isViewMode();
        await viewBaseQty();
        await displayAssignedTo();
        await hideSerialNumberRecordTab();
        await displayManufacturingAndExpiredDate(status, pageStatus);
        await disabledItemBundleFields();
        break;
    }
  } catch (error) {
    this.$message.error(error);
    console.error(error);
  }
})();

setTimeout(async () => {
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("gr_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }
  var params = this.getComponent("gr_no");
  const { options } = params;

  const optionsData = this.getOptionData("gr_no_type") || [];
  const defaultData = getDefaultItem(optionsData);
  if (options?.canManualInput) {
    this.setOptionData("gr_no_type", [
      { label: "Manual Input", value: -9999 },
      ...optionsData,
    ]);
    if (this.isAdd) {
      this.setData({
        gr_no_type: defaultData ? defaultData.value : -9999,
      });
    }
  } else if (defaultData) {
    if (this.isAdd) {
      this.setData({ gr_no_type: defaultData.value });
    }
  }
}, 200);
