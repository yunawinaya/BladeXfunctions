const data = this.getValues();
const items = data.table_so;
const exchangeRate = data.exchange_rate;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;
let totalItems = items.length;

const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

if (Array.isArray(items)) {
  items.forEach((item, index) => {
    // Ensure values are numeric
    const quantity = Number(item.so_quantity) || 0;
    const unitPrice = roundPrice(item.so_item_price) || 0;
    const grossValue = quantity * unitPrice;

    if (totalItems > 0) {
      this.setData({
        partially_delivered: `0 / ${totalItems}`,
      });
      this.setData({
        fully_delivered: `0 / ${totalItems}`,
      });
    }

    totalGross += roundPrice(grossValue);

    console.log("totalGross", totalGross);

    this.setData({
      [`table_so.${index}.so_gross`]: roundPrice(grossValue),
      [`table_so.${index}.so_amount`]: roundPrice(grossValue),
      so_total_gross: roundPrice(totalGross),
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
          discountAmount = roundPrice(discount);
        } else if (discountUOM === "%") {
          discountAmount = roundPrice((grossValue * discount) / 100);
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
            [`table_so.${index}.so_discount_amount`]:
              roundPrice(discountAmount),
          });
        }
      }
    } else {
      this.setData({
        [`table_so.${index}.so_discount_amount`]: 0,
      });
    }
    // Calculate amount after discount
    const amountAfterDiscount = roundPrice(grossValue - discountAmount);

    // Calculate tax amount based on taxInclusive flag
    let taxAmount = 0;
    let finalAmount = amountAfterDiscount;

    if (taxRate) {
      const taxRateDecimal = taxRate / 100;

      if (taxInclusive === 1) {
        taxAmount = roundPrice(
          amountAfterDiscount - amountAfterDiscount / (1 + taxRateDecimal)
        );
        finalAmount = amountAfterDiscount;
      } else {
        taxAmount = roundPrice(amountAfterDiscount * taxRateDecimal);
        finalAmount = amountAfterDiscount + taxAmount;
      }

      // Set tax amount
      this.setData({
        [`table_so.${index}.so_tax_amount`]: taxAmount,
      });
    } else {
      this.setData({
        [`table_so.${index}.so_tax_amount`]: 0,
      });
    }

    // Set final amount
    this.setData({
      [`table_so.${index}.so_amount`]: roundPrice(finalAmount),
    });

    // Subtract previous values before adding new ones
    totalDiscount += roundPrice(discountAmount);
    totalTax += roundPrice(taxAmount);
    totalAmount += roundPrice(finalAmount);

    if (totalTax > 0) {
      this.display(["so_total_tax", "total_tax_currency"]);
    }

    // Set the total fields
    this.setData({
      so_total_discount: roundPrice(totalDiscount),
      so_total_tax: roundPrice(totalTax),
      so_total: roundPrice(totalAmount),
    });

    if (!exchangeRate) {
      return;
    } else {
      const myrTotal = exchangeRate * totalAmount;
      this.setData({
        myr_total_amount: roundPrice(myrTotal),
      });
    }
  }); // This closing bracket was missing for the forEach callback

  return items;
} else {
  console.log("Not an array:", items);
  return items;
}
