// Item Code on a manually added component row. Mirrors MSI's onAfterUpdate_item,
// with the UOM options resolved in one batched query rather than one per UOM.
//
// requested_qty is left at 0: the row carries no BOM demand, which is also what
// marks it as added when the BOM variance is reported at completion.

const clearRow = (rowIndex, extra) =>
  this.setData(
    Object.assign(
      {
        [`stock_movement.${rowIndex}.requested_qty`]: 0,
        [`stock_movement.${rowIndex}.total_quantity`]: 0,
        [`stock_movement.${rowIndex}.balance_id`]: "",
        [`stock_movement.${rowIndex}.temp_qty_data`]: "",
        [`stock_movement.${rowIndex}.temp_hu_data`]: "",
        [`stock_movement.${rowIndex}.stock_summary`]: "",
      },
      extra
    )
  );

(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const value = arguments[0].value;

    if (!value) {
      await clearRow(rowIndex, {
        [`stock_movement.${rowIndex}.item_name`]: "",
        [`stock_movement.${rowIndex}.item_desc`]: "",
        [`stock_movement.${rowIndex}.quantity_uom`]: "",
        [`stock_movement.${rowIndex}.uom_options`]: "",
      });
      return;
    }

    const itemData = arguments[0]?.fieldModel?.item;
    if (!itemData) {
      // The table re-renders without a fieldModel on a plain refresh; restore the
      // UOM options every row already carries so no select goes blank.
      const lines = this.getValue("stock_movement") || [];
      lines.forEach((line, idx) => {
        let options = [];
        try {
          options = JSON.parse(line.uom_options || "[]");
        } catch (e) {}
        this.setOptionData([`stock_movement.${idx}.quantity_uom`], options);
      });
      return;
    }

    const allData = this.getValues();

    const uomIds = [
      itemData.based_uom,
      ...(itemData.table_uom_conversion || []).map((conv) => conv.alt_uom_id),
    ]
      .filter(Boolean)
      .filter((id, i, arr) => arr.indexOf(id) === i);

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

    const uomOptions = uomRes.data || [];

    await clearRow(rowIndex, {
      [`stock_movement.${rowIndex}.item_name`]: itemData.material_name || "",
      [`stock_movement.${rowIndex}.item_desc`]: itemData.material_desc || "",
      [`stock_movement.${rowIndex}.quantity_uom`]: itemData.based_uom || "",
      [`stock_movement.${rowIndex}.uom_options`]: JSON.stringify(uomOptions),
      // Seeded here the same way the explosion seeds its rows, so an added line
      // reaches the save workflow with the same columns filled.
      [`stock_movement.${rowIndex}.organization_id`]: allData.organization_id,
      [`stock_movement.${rowIndex}.issuing_plant`]:
        allData.issuing_operation_faci || "",
      [`stock_movement.${rowIndex}.project_id`]: allData.project_id || "",
    });

    this.setOptionData([`stock_movement.${rowIndex}.quantity_uom`], uomOptions);
  } catch (error) {
    console.error("Error loading the component item:", error);
    this.$message.error(error.message || "Failed to load the item");
  }
})();
