(async () => {
  console.log("arguments", arguments[0]);
  const rowIndex = arguments[0].rowIndex;

  await this.setData({
    [`hu_dialog.table_hu.${rowIndex}.line_index`]: rowIndex,
  });

  await this.disabled(
    [
      `hu_dialog.table_hu.${rowIndex}.handling_no`,
      `hu_dialog.table_hu.${rowIndex}.hu_material_id`,
      `hu_dialog.table_hu.${rowIndex}.gross_weight`,
      `hu_dialog.table_hu.${rowIndex}.net_weight`,
      `hu_dialog.table_hu.${rowIndex}.remark`,
    ],
    false,
  );
})();
