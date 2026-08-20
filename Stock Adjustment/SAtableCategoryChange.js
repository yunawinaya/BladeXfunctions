(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const category = arguments[0].value;

    const serialNumber = await this.getValue(
      `sa_item_balance.table_item_balance.${rowIndex}.serial_number`,
    );

    if (!category || category === "") {
      this.setData({
        [`sa_item_balance.table_item_balance.${rowIndex}.movement_type`]:
          undefined,
      });
    }

    if (!serialNumber || serialNumber === "") {
      return;
    }

    let tableItemBalanceRaw = JSON.parse(
      await this.getValue("sa_item_balance.table_item_balance_raw"),
    );

    tableItemBalanceRaw.forEach((item) => {
      if (item.serial_number === serialNumber) {
        item.category = category;
      }
    });

    await this.setData({
      "sa_item_balance.table_item_balance_raw":
        JSON.stringify(tableItemBalanceRaw),
    });

    console.log("Table Raw Updated");
  } catch (error) {
    console.error("Unexpected error in on change SN qty handler:", error);
  }
})();
