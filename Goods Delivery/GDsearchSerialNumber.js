(async () => {
  try {
    const value = this.getValue("gd_item_balance.search_serial_number");

    const tableItemBalanceRaw = JSON.parse(
      this.getValue("gd_item_balance.table_item_balance_raw")
    );

    const filteredSerialNumber = tableItemBalanceRaw.filter((item) =>
      item.serial_number.includes(value)
    );

    await this.setData({
      "gd_item_balance.table_item_balance": filteredSerialNumber,
    });
  } catch (error) {
    console.error("Unexpected error in search serial number handler:", error);
  }
})();
