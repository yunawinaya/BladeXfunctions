setTimeout(() => {
  const data = this.getValues();
  if (data.table_gd) {
    const rowIndex = arguments[0]?.rowIndex;
    const deliveredQty = arguments[0]?.value;

    const orderQty = data.table_gd[rowIndex]?.gd_order_quantity;

    const remainingQty = orderQty - deliveredQty;

    if (remainingQty > 0) {
      this.setData({
        [`table_gd.${rowIndex}.gd_undelivered_qty`]: remainingQty,
      });
    }
  }
}, 300);
