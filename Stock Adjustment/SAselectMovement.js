const allData = this.getValues();
const selectedMovement = arguments[0]?.value;
const rowIndex = arguments[0]?.rowIndex;
const subFormIndex = allData.sa_item_balance.row_index;
const tableItemBalance = allData.sa_item_balance.table_item_balance;

const triggerMovement = () => {
  if (selectedMovement === "In") {
    for (let i = 0; i < tableItemBalance.length; i++) {
      this.setData({
        [`sa_item_balance.table_item_balance.${i}.movement_type`]: "In",
      });
      this.display(`subform_dus1f9ob.${subFormIndex}.unit_price`);
      this.disabled(`subform_dus1f9ob.${subFormIndex}.unit_price`, false);
    }
  } else if (selectedMovement === "Out") {
    for (let i = 0; i < tableItemBalance.length; i++) {
      this.setData({
        [`sa_item_balance.table_item_balance.${i}.movement_type`]: "Out",
      });
      this.hide(`subform_dus1f9ob.${subFormIndex}.unit_price`);
      this.disabled(`subform_dus1f9ob.${subFormIndex}.unit_price`, true);
    }
  }
};

const resetMovement = () => {
  for (let i = 0; i < tableItemBalance.length; i++) {
    if (!tableItemBalance[i].category) {
      this.setData({
        [`sa_item_balance.table_item_balance.${i}.movement_type`]: undefined,
      });
    }
  }
};

const Movement = async () => {
  await triggerMovement();
  await resetMovement();
};

Movement();
