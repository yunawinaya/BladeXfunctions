const data = this.getValues();
const items = data.table_po;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;

if (Array.isArray(items)) {
  items.forEach((item, index) => {
    // Ensure values are numeric
    const quantity = Number(item.quantity) || 0;
    const unitPrice = parseFloat(item.unit_price) || 0;

    // Calculate gross for this specific item
    const grossValue = quantity * unitPrice;

    // Set gross value
    this.setData({
      [`table_po.${index}.gross`]: grossValue,
    });
    this.setData({
      [`table_po.${index}.po_amount`]: grossValue,
    });
    item.gross = grossValue;

    // Update running total for gross immediately
    totalGross += grossValue;

    // Update the total gross field immediately
    this.setData({
      po_total_gross: totalGross,
    });

    // Get discount, discountUOM, and tax info for this row
    let discount = parseFloat(this.getValue(`table_po.${index}.discount`)) || 0;
    const discountUOM = this.getValue(`table_po.${index}.discount_uom`);
    const taxRate =
      Number(this.getValue(`table_po.${index}.tax_rate_percent`)) || 0;
    const taxInclusive = this.getValue(`table_po.${index}.tax_inclusive`);
    let discountAmount = 0.0;

    if (discountUOM) {
      // Calculate discount amount using UOM from database
      if (discount !== 0) {
        if (discountUOM === "Amount") {
          discountAmount = discount;
        } else if (discountUOM === "%") {
          discountAmount = (grossValue * discount) / 100;
        }

        if (discountAmount > grossValue) {
          discount = 0;
          discountAmount = 0;

          this.setData({
            [`table_po.${index}.discount`]: 0,
            [`table_po.${index}.discount_amount`]: 0,
          });
        } else {
          this.setData({
            [`table_po.${index}.discount_amount`]: parseFloat(
              discountAmount.toFixed(2)
            ),
          });
        }

        item.discount = discount;
        item.discount_amount = discountAmount;
      }
    } else {
      this.setData({
        [`table_po.${index}.discount_amount`]: 0,
      });
    }

    const amountAfterDiscount = grossValue - discountAmount;

    // Calculate tax amount based on taxInclusive flag
    let taxAmount = 0;
    let finalAmount = amountAfterDiscount;

    if (taxRate) {
      const taxRateDecimal = taxRate / 100;

      if (taxInclusive === 1) {
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
        [`table_po.${index}.tax_amount`]: parseFloat(taxAmount.toFixed(2)),
      });
      item.tax_amount = taxAmount;
    } else {
      this.setData({
        [`table_po.${index}.tax_amount`]: 0,
      });
      item.tax_amount = 0;
    }

    // Set final amount
    this.setData({
      [`table_po.${index}.po_amount`]: parseFloat(finalAmount.toFixed(2)),
    });
    item.po_amount = finalAmount;

    // Subtract previous values before adding new ones
    totalDiscount += discountAmount;
    totalTax += taxAmount;
    totalAmount += finalAmount;

    if (totalTax > 0) {
      this.display(["po_total_tax", "total_tax_currency"]);
    }

    // Set the total fields
    this.setData({
      po_total_discount: parseFloat(totalDiscount.toFixed(2)),
      po_total_tax: parseFloat(totalTax.toFixed(2)),
      po_total: parseFloat(totalAmount.toFixed(2)),
    });
  });

  return items;
} else {
  console.log("Not an array:", items);
  return items;
}
