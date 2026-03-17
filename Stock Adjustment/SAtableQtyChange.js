(async () => {
  try {
    const rowIndex = arguments[0].rowIndex;
    const sa_quantity = arguments[0].value;

    console.log("Row Index:", rowIndex);
    console.log("SA Quantity:", sa_quantity);

    const adjustment_type = await this.getValue("adjustment_type");

    if (adjustment_type === "Stock Count") {
      if (sa_quantity < 0) {
        await this.setData({
          [`sa_item_balance.table_item_balance.${rowIndex}.movement_type`]: "OUT",
        });
      } else {
        await this.setData({
          [`sa_item_balance.table_item_balance.${rowIndex}.movement_type`]: "IN",
        });
      }
    }

    const serialNumber = await this.getValue(
      `sa_item_balance.table_item_balance.${rowIndex}.serial_number`,
    );

    if (!serialNumber || serialNumber === "") {
      return;
    }

    let tableItemBalanceRaw = JSON.parse(
      await this.getValue("sa_item_balance.table_item_balance_raw"),
    );

    tableItemBalanceRaw.forEach((item) => {
      if (item.serial_number === serialNumber) {
        item.sa_quantity = sa_quantity;
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
