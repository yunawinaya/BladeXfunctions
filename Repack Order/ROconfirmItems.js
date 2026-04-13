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

(async () => {
  try {
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

    const tableRepack = this.getValue("table_repack") || [];
    const currentRow = tableRepack[rowIndex] || {};
    let handlingNo = "";
    if (currentRow.source_temp_data) {
      try {
        const parsed = JSON.parse(currentRow.source_temp_data);
        handlingNo = parsed?.handling_no || "";
      } catch (e) {
        console.error("Error parsing source_temp_data:", e);
      }
    }

    const itemDetails = await buildItemDetails(itemsSnapshot, handlingNo);

    await this.setData({
      [`table_repack.${rowIndex}.items_temp_data`]: JSON.stringify(itemsSnapshot),
      [`table_repack.${rowIndex}.item_details`]: itemDetails,
    });

    await this.closeDialog("dialog_repack");
  } catch (error) {
    this.$message.error("Error in ROconfirmItems: " + error.message);
    console.error("Error in ROconfirmItems:", error);
  }
})();
