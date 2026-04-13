(async () => {
  const repackType = arguments[0]?.value ?? (await this.getValue("repack_type"));

  const existingRepack = this.getValue("table_repack") || [];
  const hasData = existingRepack.some(
    (row) =>
      row &&
      (row.handling_unit_id ||
        row.target_hu_id ||
        row.target_hu_no ||
        row.source_temp_data ||
        row.target_temp_data ||
        row.items_temp_data ||
        row.item_details),
  );

  if (hasData) {
    this.$alert(
      "Changing the repack type has <strong>reset all repack lines</strong>.",
      "Repack Type Changed",
      {
        confirmButtonText: "OK",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    );
  }

  await this.setData({ table_repack: [] });

  const sourceHuCols = [
    "table_repack.button_source_hu",
    "table_repack.handling_unit_id",
    "table_repack.total_hu_item_quantity",
    "table_repack.hu_storage_location",
    "table_repack.hu_location",
  ];

  const targetWarehouseCols = [
    "table_repack.target_storage_location",
    "table_repack.target_location",
  ];

  const targetHuCols = [
    "table_repack.button_target_hu",
    "table_repack.target_hu_no",
    "table_repack.target_hu_location",
  ];

  switch (repackType) {
    case "Load":
      await this.hide([...sourceHuCols, ...targetWarehouseCols]);
      await this.display(targetHuCols);
      break;
    case "Unload":
      await this.display([...sourceHuCols, ...targetWarehouseCols]);
      await this.hide(targetHuCols);
      break;
    case "Transfer":
      await this.display([
        ...sourceHuCols,
        ...targetWarehouseCols,
        ...targetHuCols,
      ]);
      break;
    default:
      break;
  }
})();
