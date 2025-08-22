(async () => {
  const tableSerialNumber = this.getValue(
    "dialog_serial_number.table_serial_number"
  );

  const tableRows = tableSerialNumber.length - 1;

  console.log("tableRows", tableRows);

  await this.setData({
    [`dialog_serial_number.serial_number_qty`]: tableRows,
    [`dialog_serial_number.new_rows`]: tableRows,
  });

  await this.refreshDynamicValue("dialog_serial_number.total_qty_display");
})();
