(async () => {
  const repackType = arguments[0]?.value ?? (await this.getValue("repack_type"));

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
    "table_repack.target_hu_id",
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
