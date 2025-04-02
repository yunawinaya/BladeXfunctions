const data = this.getValues();
console.log("Data", data);
const items = data.table_si;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;

if (Array.isArray(items)) {
  items.forEach((item, index) => {
    const quantity = Number(item.invoice_qty) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const grossValue = quantity * unitPrice;

    this.setData({
      [`table_si.${index}.gross`]: grossValue,
    });
    this.setData({
      [`table_si.${index}.si_amount`]: grossValue,
    });
    item.gross = grossValue;
    totalGross += grossValue;

    this.setData({
      invoice_subtotal: totalGross,
    });

    let discount = Number(this.getValue(`table_si.${index}.si_discount`)) || 0;
    const discountUOM = this.getValue(`table_si.${index}.si_discount_uom_id`);
    const taxRate =
      Number(this.getValue(`table_si.${index}.tax_rate_percent`)) || 0;
    let taxInclusive = this.getValue(`table_si.${index}.si_tax_inclusive`);

    taxInclusive =
      (taxInclusive && taxInclusive.length > 0) || taxInclusive === 1;

    db.collection("unit_of_measurement")
      .where({ id: discountUOM })
      .get()
      .then((response) => {
        const uomData = response.data[0];
        if (!uomData) {
          console.error("UOM not found for ID:", discountUOM);
          return;
        }

        let discountAmount = 0;
        if (discount) {
          if (uomData.uom_name === "Amount") {
            discountAmount = discount;
          } else if (uomData.uom_name === "%") {
            discountAmount = (grossValue * discount) / 100;
          }
          if (discountAmount > grossValue) {
            console.log(
              `Resetting discount and discount_amount for index ${index} as discount > gross`
            );
            discount = 0;
            discountAmount = 0;

            this.setData({
              [`table_si.${index}.si_discount`]: 0,
              [`table_si.${index}.discount_amount`]: 0,
            });
          } else {
            this.setData({
              [`table_si.${index}.discount_amount`]: discountAmount,
            });
          }

          item.si_discount = discount;
          item.discount_amount = discountAmount;
        }

        const amountAfterDiscount = grossValue - discountAmount;
        let taxAmount = 0;
        let finalAmount = amountAfterDiscount;

        if (taxRate) {
          const taxRateDecimal = taxRate / 100;
          this.display("invoice_taxes_amount");

          if (taxInclusive) {
            taxAmount =
              amountAfterDiscount - amountAfterDiscount / (1 + taxRateDecimal);
            finalAmount = amountAfterDiscount;
          } else {
            taxAmount = amountAfterDiscount * taxRateDecimal;
            finalAmount = amountAfterDiscount + taxAmount;
          }

          this.setData({
            [`table_si.${index}.tax_amount`]: taxAmount,
          });
          item.tax_amount = taxAmount;
        } else {
          this.hide("invoice_taxes_amount");
          this.setData({
            [`table_si.${index}.tax_amount`]: 0,
          });
          item.tax_amount = 0;
        }

        this.setData({
          [`table_si.${index}.invoice_amount`]: finalAmount,
        });
        item.invoice_amount = finalAmount;

        totalDiscount += discountAmount;
        totalTax += taxAmount;
        totalAmount += finalAmount;

        this.setData({
          invoice_total_discount: totalDiscount,
          invoice_taxes_amount: totalTax,
          invoice_total: totalAmount,
        });
      });
  });

  this.setData({
    invoice_total: totalGross,
  });

  console.log("Updated items with calculations:", items);
  console.log("Totals calculated:", {
    totalGross,
    totalDiscount,
    totalTax,
    totalAmount,
  });

  const updatedData = this.getValues();
  console.log("Form data after update:", updatedData);

  return items;
} else {
  console.log("Not an array:", items);
  return items;
}
