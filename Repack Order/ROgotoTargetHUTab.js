const buildItemDetails = async (selectedItems, handlingNo) => {
  const batchIds = [
    ...new Set(selectedItems.map((it) => it.batch_id).filter(Boolean)),
  ];
  const uomIds = [
    ...new Set(selectedItems.map((it) => it.material_uom).filter(Boolean)),
  ];

  const [batchRes, uomRes] = await Promise.all([
    batchIds.length > 0
      ? db
          .collection("batch")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [{ prop: "id", operator: "in", value: batchIds }],
            },
          ])
          .get()
      : Promise.resolve({ data: [] }),
    uomIds.length > 0
      ? db
          .collection("unit_of_measurement")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [{ prop: "id", operator: "in", value: uomIds }],
            },
          ])
          .get()
      : Promise.resolve({ data: [] }),
  ]);

  const batchMap = new Map();
  (batchRes.data || []).forEach((b) => batchMap.set(b.id, b.batch_number));
  const uomMap = new Map();
  (uomRes.data || []).forEach((u) => uomMap.set(u.id, u.uom_name));

  const prefix = handlingNo ? `[HU: ${handlingNo}] ` : "[Inventory] ";

  return selectedItems
    .map((it) => {
      const name = it.material_name || it.material_id;
      const batchName = it.batch_id ? batchMap.get(it.batch_id) || "" : "";
      const uomName = it.material_uom ? uomMap.get(it.material_uom) || "" : "";
      const batchPart = batchName ? ` [Batch: ${batchName}]` : "";
      return `${prefix}${name}${batchPart} - ${it.unload_quantity} ${uomName}`.trim();
    })
    .join("\n");
};

const selectTab = (tabName) => {
  setTimeout(() => {
    const tabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-${tabName}`;
    const tab = document.querySelector(tabSelector);

    if (tab) {
      tab.style.display = "flex";
      tab.setAttribute("aria-selected", "true");
      tab.setAttribute("aria-disabled", "false");
      tab.setAttribute("tabindex", "0");
      tab.classList.remove("is-disabled");
      tab.classList.add("is-active");
      tab.click();
    } else {
      console.log(`Tab ${tabName} not found`);
    }
  }, 100);
};

(async () => {
  try {
    this.showLoading("Loading target handling units...");

    const dialogData = this.getValue("dialog_repack");
    if (!dialogData) {
      throw new Error("Dialog data not available");
    }

    const rowIndex = dialogData.row_index;
    if (typeof rowIndex !== "number") {
      throw new Error("Row index missing on dialog");
    }

    const tableItems = dialogData.table_items || [];
    const selectedItems = tableItems.filter(
      (it) => (parseFloat(it.unload_quantity) || 0) > 0,
    );

    if (selectedItems.length === 0) {
      this.hideLoading();
      this.$message.error("Please enter quantity for at least one item");
      return;
    }

    const itemsSnapshot = selectedItems.map((it) => ({
      material_id: it.material_id,
      material_name: it.material_name,
      material_desc: it.material_desc,
      location_id: it.location_id,
      batch_id: it.batch_id || null,
      material_uom: it.material_uom,
      item_quantity: parseFloat(it.item_quantity) || 0,
      unload_quantity: parseFloat(it.unload_quantity) || 0,
      balance_id: it.balance_id || "",
      line_status: it.line_status || "Open",
    }));

    const plantId = this.getValue("plant_id");
    const organizationId = this.getValue("organization_id");
    const tableRepack = this.getValue("table_repack") || [];
    const currentRow = tableRepack[rowIndex] || {};

    let sourceHuId = null;
    let handlingNo = "";
    if (currentRow.source_temp_data) {
      try {
        const parsed = JSON.parse(currentRow.source_temp_data);
        sourceHuId = parsed?.id || null;
        handlingNo = parsed?.handling_no || "";
      } catch (e) {
        console.error("Error parsing source_temp_data:", e);
      }
    }

    const itemDetails = await buildItemDetails(itemsSnapshot, handlingNo);

    const responseHU = await db
      .collection("handling_unit")
      .where({
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get();

    const allHUs = (responseHU && responseHU.data) || [];
    const availableTargetHUs = allHUs.filter((hu) => hu.id !== sourceHuId);

    let previouslySelectedId = null;
    if (currentRow.target_temp_data) {
      try {
        const parsed = JSON.parse(currentRow.target_temp_data);
        previouslySelectedId = parsed?.id || null;
      } catch (e) {
        console.error("Error parsing target_temp_data:", e);
      }
    }

    const tableTargetHU = availableTargetHUs.map((hu, index) => ({
      ...hu,
      handling_unit_id: hu.id,
      line_index: index,
      select_hu: previouslySelectedId && hu.id === previouslySelectedId ? 1 : 0,
    }));

    await this.setData({
      [`table_repack.${rowIndex}.items_temp_data`]: JSON.stringify(itemsSnapshot),
      [`table_repack.${rowIndex}.item_details`]: itemDetails,
      "dialog_repack.table_target_hu": tableTargetHU,
    });

    selectTab("tab_target_hu");

    this.hideLoading();
  } catch (error) {
    this.hideLoading();
    this.$message.error("Error in ROgotoTargetHUTab: " + error.message);
    console.error("Error in ROgotoTargetHUTab:", error);
  }
})();
