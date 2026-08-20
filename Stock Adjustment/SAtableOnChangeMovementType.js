const allData = this.getValues();
const selectedMovement = arguments[0]?.value;
const rowIndex = arguments[0]?.rowIndex;
const subFormIndex = allData.sa_item_balance.row_index;
const tableItemBalance = allData.sa_item_balance.table_item_balance;

const triggerMovement = () => {
  if (selectedMovement === "In") {
    for (let i = 0; i < tableItemBalance.length; i++) {
      this.display(`stock_adjustment.${subFormIndex}.unit_price`);
      setTimeout(() => {
        this.disabled(`stock_adjustment.${subFormIndex}.unit_price`, false);
      }, 100);
    }
  } else if (selectedMovement === "Out") {
    for (let i = 0; i < tableItemBalance.length; i++) {
      this.hide(`stock_adjustment.${subFormIndex}.unit_price`);
      setTimeout(() => {
        this.disabled(`stock_adjustment.${subFormIndex}.unit_price`, true);
      }, 100);
    }
  }
};

const resetMovement = () => {
  const tableItemBalanceRowData = arguments[0].row;
  if (selectedMovement) {
    if (!tableItemBalanceRowData.category) {
      this.setData({
        [`sa_item_balance.table_item_balance.${rowIndex}.movement_type`]:
          undefined,
      });
    }
  }
};

const Movement = async () => {
  await triggerMovement();
  await resetMovement();
};

Movement();
