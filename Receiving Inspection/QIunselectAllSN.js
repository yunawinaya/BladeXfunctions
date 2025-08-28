(async () => {
  try {
    const dialogSerialNumber = this.getValue("dialog_serial_number");

    let tableSerialNumber = dialogSerialNumber.table_serial_number;

    for (const sn of tableSerialNumber) {
      sn.passed = 0;
    }

    await this.setData({
      "dialog_serial_number.table_serial_number": tableSerialNumber,
    });

    this.hide("dialog_serial_number.unselect_all");
    this.display("dialog_serial_number.select_all");
  } catch (error) {
    console.error(
      "Unexpected error in select all serial number handler:",
      error
    );
  }
})();
