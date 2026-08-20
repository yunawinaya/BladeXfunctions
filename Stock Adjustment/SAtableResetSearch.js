(async () => {
  try {
    const tableItemBalanceRaw = JSON.parse(
      this.getValue("sa_item_balance.table_item_balance_raw"),
    );

    await this.setData({
      "sa_item_balance.table_item_balance": tableItemBalanceRaw,
    });
    await this.setData({
      "sa_item_balance.search_serial_number": "",
    });
  } catch (error) {
    console.error("Unexpected error in search serial number handler:", error);
  }
})();
