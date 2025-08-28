(async () => {
  try {
    const dialogSerialNumber = this.getValue("dialog_serial_number");

    const tableSerialNumber = dialogSerialNumber.table_serial_number;

    const isSelectedAll = tableSerialNumber.every((sn) => sn.passed === 1);

    if (isSelectedAll) {
      this.hide("dialog_serial_number.select_all");
      this.display("dialog_serial_number.unselect_all");
    } else {
      this.hide("dialog_serial_number.unselect_all");
      this.display("dialog_serial_number.select_all");
    }
  } catch (error) {
    console.error(
      "Unexpected error in select all serial number handler:",
      error
    );
  }
})();
