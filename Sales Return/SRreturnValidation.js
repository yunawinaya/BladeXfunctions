const rowIndex = arguments[0].field.split(".")[1];
const grQty = this.getValue(`table_sr.${rowIndex}.good_delivery_qty`);
const toReturnedQty = this.getValue(`table_sr.${rowIndex}.to_returned_qty`);

if (value > grQty) {
  callback("Exceeds the delivery quantity");
}

if (value > toReturnedQty) {
  callback("Exceeds the returnable quantity");
}
