const allData = this.getValues();
const tableItemBalance = allData.sa_item_balance.table_item_balance;
const isSerialized = allData.sa_item_balance.is_serialized;

for (let i = 0; i < tableItemBalance.length; i++) {
  if (!tableItemBalance[i].category) {
    this.disabled(
      `sa_item_balance.table_item_balance.${i}.movement_type`,
      true
    );
    this.disabled(`sa_item_balance.table_item_balance.${i}.sa_quantity`, true);
  } else {
    if (isSerialized !== 1) {
      this.disabled(
        `sa_item_balance.table_item_balance.${i}.movement_type`,
        false
      );
    }
    this.disabled(`sa_item_balance.table_item_balance.${i}.sa_quantity`, false);
  }
}
