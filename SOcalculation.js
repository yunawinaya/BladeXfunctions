const data = this.getValues();
console.log("Data", data);
const items = data.table_so;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;

if (Array.isArray(items)) {
  items.forEach((item, index) => {
    // Ensure values are numeric
    const quantity = Number(item.so_quantity) || 0;
    const unitPrice = Number(item.so_item_price) || 0;

    // Calculate gross for this specific item
    const grossValue = quantity * unitPrice;

    // Set gross value
    this.setData({
      [`table_so.${index}.so_gross`]: grossValue,
    });
    this.setData({
      [`table_so.${index}.so_amount`]: grossValue,
    });
    item.so_gross = grossValue;

    // Update running total for gross immediately
    totalGross += grossValue;

    // Update the total gross field immediately
    this.setData({
      so_total_gross: totalGross,
    });

    // Get discount, discountUOM, and tax info for this row
    let discount = Number(this.getValue(`table_so.${index}.so_discount`)) || 0;
    const discountUOM = this.getValue(`table_so.${index}.so_discount_uom`);
    const taxRate =
      Number(this.getValue(`table_so.${index}.so_tax_percentage`)) || 0;
    let taxInclusive = this.getValue(`table_so.${index}.so_tax_inclusive`);

    // Convert taxInclusive to a boolean or number value
    taxInclusive =
      (taxInclusive && taxInclusive.length > 0) || taxInclusive === 1;

    // Use database to get UOM information
    db.collection("unit_of_measurement")
      .where({ id: discountUOM })
      .get()
      .then((response) => {
        const uomData = response.data[0];
        if (!uomData) {
          console.error("UOM not found for ID:", discountUOM);
          return;
        }

        // Calculate discount amount using UOM from database
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
              [`table_so.${index}.so_discount`]: 0,
              [`table_so.${index}.so_discount_amount`]: 0,
            });
          } else {
            this.setData({
              [`table_so.${index}.so_discount_amount`]: discountAmount,
            });
          }

          item.so_discount = discount;
          item.so_discount_amount = discountAmount;
        }

        // Calculate amount after discount
        const amountAfterDiscount = grossValue - discountAmount;

        // Calculate tax amount based on taxInclusive flag
        let taxAmount = 0;
        let finalAmount = amountAfterDiscount;

        if (taxRate) {
          const taxRateDecimal = taxRate / 100;
          this.display("so_total_tax");

          if (taxInclusive) {
            // Tax inclusive calculation
            taxAmount =
              amountAfterDiscount - amountAfterDiscount / (1 + taxRateDecimal);
            finalAmount = amountAfterDiscount;
          } else {
            // Tax exclusive calculation
            taxAmount = amountAfterDiscount * taxRateDecimal;
            finalAmount = amountAfterDiscount + taxAmount;
          }

          // Set tax amount
          this.setData({
            [`table_so.${index}.so_tax_amount`]: taxAmount,
          });
          item.so_tax_amount = taxAmount;
        } else {
          this.hide("so_total_tax");
          this.setData({
            [`table_so.${index}.so_tax_amount`]: 0,
          });
          item.so_tax_amount = 0;
        }

        // Set final amount
        this.setData({
          [`table_so.${index}.so_amount`]: finalAmount,
        });
        item.so_amount = finalAmount;

        // Subtract previous values before adding new ones
        totalDiscount += discountAmount;
        totalTax += taxAmount;
        totalAmount += finalAmount;

        // Set the total fields
        this.setData({
          so_total_discount: totalDiscount,
          so_total_tax: totalTax,
          so_total: totalAmount,
        });
      });
  });

  this.setData({
    so_total: totalGross,
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
