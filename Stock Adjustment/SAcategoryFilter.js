const data = this.getValues();

const categoryType = data.adjustment_type;
const stockAdjustmentTable = data.sa_item_balance.table_item_balance;

for (let i = 0; i < stockAdjustmentTable.length; i++) {
  const categoryData = this.getOptionData(
    `sa_item_balance.table_item_balance.${i}.category`
  );
  console.log("categoryData", categoryData);

  if (categoryType === "Stock Count") {
    const filteredCategories = categoryData.filter(
      (item) => item.value !== "Reserved"
    );

    this.setOptionData(
      `sa_item_balance.table_item_balance.${i}.category`,
      filteredCategories
    );
  }
}
