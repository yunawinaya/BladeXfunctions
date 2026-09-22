// Confirm of the shared Batch Add picker (page 1983386084789420033). The handler
// name is the callback convention that page uses -- MSI, MSR, SA, LOT, PT and CAT
// all expose it under exactly this name.
//
// Rows arrive with no quantity: requested_qty stays 0 because they carry no BOM
// demand, and the user types a quantity next, which allocates the line.

(async () => {
  try {
    const currentItemArray = arguments[0].itemArray || [];

    if (currentItemArray.length === 0) {
      this.$alert("Please select at least one item.", "Error", {
        confirmButtonText: "OK",
        type: "error",
      });
      return;
    }

    const allData = this.getValues();
    const existingLines = allData.stock_movement || [];

    // Every selected item's UOMs resolved in one query rather than one per item.
    const uomIds = [
      ...new Set(
        currentItemArray
          .flatMap((item) => [
            item.based_uom,
            ...(item.table_uom_conversion || []).map((conv) => conv.alt_uom_id),
          ])
          .filter(Boolean)
      ),
    ];

    const uomRes = uomIds.length
      ? await db
          .collection("unit_of_measurement")
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "id", operator: "in", value: uomIds },
                { prop: "is_deleted", operator: "equal", value: 0 },
              ],
            },
          ])
          .get()
          .catch(() => ({ data: [] }))
      : { data: [] };

    const uomMap = new Map((uomRes.data || []).map((uom) => [uom.id, uom]));

    const newRows = currentItemArray.map((item, index) => {
      const rowUoms = [
        item.based_uom,
        ...(item.table_uom_conversion || []).map((conv) => conv.alt_uom_id),
      ]
        .filter(Boolean)
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .map((id) => uomMap.get(id))
        .filter(Boolean);

      return {
        item_selection: item.id,
        item_name: item.material_name || "",
        item_desc: item.material_desc || "",
        requested_qty: 0,
        total_quantity: 0,
        quantity_uom: item.based_uom || "",
        uom_options: JSON.stringify(rowUoms),
        item_remark: "",
        project_id: allData.project_id || "",
        organization_id: allData.organization_id,
        issuing_plant: allData.issuing_operation_faci || "",
        line_index: existingLines.length + index + 1,
        balance_id: "",
        temp_qty_data: "",
        temp_hu_data: "",
        stock_summary: "",
      };
    });

    await this.setData({
      stock_movement: [...existingLines, ...newRows],
    });

    newRows.forEach((row, index) => {
      let options = [];
      try {
        options = JSON.parse(row.uom_options);
      } catch (e) {}
      this.setOptionData(
        [`stock_movement.${existingLines.length + index}.quantity_uom`],
        options
      );
    });

    this.closeDialog("dialog_item_selection");
  } catch (error) {
    console.error("Error adding the selected items:", error);
    this.$message.error(error.message || "Failed to add the selected items");
  }
})();
