(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const gdQty = arguments[0].value;

    const serialNumber = await this.getValue(
      `gd_item_balance.table_item_balance.${rowIndex}.serial_number`
    );

    if (!serialNumber || serialNumber === "") {
      return;
    }

    let tableItemBalanceRaw = JSON.parse(
      await this.getValue("gd_item_balance.table_item_balance_raw")
    );

    tableItemBalanceRaw.forEach((item) => {
      if (item.serial_number === serialNumber) {
        item.gd_quantity = gdQty;
      }
    });

    await this.setData({
      "gd_item_balance.table_item_balance_raw":
        JSON.stringify(tableItemBalanceRaw),
    });

    console.log("Table Raw Updated");
  } catch (error) {
    console.error("Unexpected error in on change SN qty handler:", error);
  }
})();
