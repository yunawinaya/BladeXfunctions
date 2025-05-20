const data = this.getValues();
const items = data.table_so;
const exchangeRate = data.exchange_rate;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;
let totalItems = items.length;

if (Array.isArray(items)) {
  items.forEach((item, index) => {
    // Ensure values are numeric
    const quantity = Number(item.so_quantity) || 0;
    const unitPrice = parseFloat(item.so_item_price) || 0;
    const grossValue = quantity * unitPrice;

    if (totalItems > 0) {
      this.setData({
        partially_delivered: `0 / ${totalItems}`,
      });
      this.setData({
        fully_delivered: `0 / ${totalItems}`,
      });
    }

    totalGross += grossValue;

    this.setData({
      [`table_so.${index}.so_gross`]: grossValue,
      [`table_so.${index}.so_amount`]: grossValue,
      so_total_gross: totalGross,
    });

    // Get discount, discountUOM, and tax info for this row
    let discount = parseFloat(item.so_discount) || 0;
    let discountUOM = item.so_discount_uom;
    let discountAmount = 0.0;
    const taxRate = Number(item.so_tax_percentage) || 0;
    const taxInclusive = item.so_tax_inclusive;

    if (discount > 0) {
      if (!discountUOM) {
        discountUOM = "Amount";
        this.setData({ [`table_so.${index}.so_discount_uom`]: "Amount" });
      }
    }

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
            [`table_so.${index}.so_discount`]: 0,
            [`table_so.${index}.so_discount_amount`]: 0,
          });
        } else {
          this.setData({
            [`table_so.${index}.so_discount_amount`]: parseFloat(
              discountAmount.toFixed(2)
            ),
          });
        }
      } else {
        this.setData({ [`table_so.${index}.so_discount_uom`]: "" });
      }
    } else {
      this.setData({
        [`table_so.${index}.so_discount_amount`]: 0,
      });
    }
    // Calculate amount after discount
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
        [`table_so.${index}.so_tax_amount`]: parseFloat(taxAmount.toFixed(2)),
      });
    } else {
      this.setData({
        [`table_so.${index}.so_tax_amount`]: 0,
      });
    }

    // Set final amount
    this.setData({
      [`table_so.${index}.so_amount`]: parseFloat(finalAmount.toFixed(2)),
    });

    // Subtract previous values before adding new ones
    totalDiscount += discountAmount;
    totalTax += taxAmount;
    totalAmount += finalAmount;

    if (totalTax > 0) {
      this.display(["so_total_tax", "total_tax_currency"]);
    }

    // Set the total fields
    this.setData({
      so_total_discount: parseFloat(totalDiscount.toFixed(2)),
      so_total_tax: parseFloat(totalTax.toFixed(2)),
      so_total: parseFloat(totalAmount.toFixed(2)),
    });

    if (!exchangeRate) {
      return;
    } else {
      this.setData({
        myr_total_amount: exchangeRate * parseFloat(totalAmount.toFixed(2)),
      });
    }
  }); // This closing bracket was missing for the forEach callback

  return items;
} else {
  console.log("Not an array:", items);
  return items;
}
