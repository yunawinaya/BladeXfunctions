const data = this.getValues();
const items = data.table_po;
const exchangeRate = data.exchange_rate;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;
let totalItems = items.length;

if (Array.isArray(items)) {
  items.forEach((item, index) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = parseFloat(item.unit_price) || 0;
    const grossValue = quantity * unitPrice;

    if (totalItems > 0) {
      this.setData({
        partially_received: `0 / ${totalItems}`,
      });
      this.setData({
        fully_received: `0 / ${totalItems}`,
      });
    }

    totalGross += grossValue;

    this.setData({
      [`table_po.${index}.gross`]: grossValue,
      [`table_po.${index}.po_amount`]: grossValue,
      po_total_gross: totalGross,
    });

    let discount = parseFloat(item.discount) || 0;
    let discountUOM = item.discount_uom;
    let discountAmount = 0.0;
    const taxRate = Number(item.tax_rate_percent) || 0;
    const taxInclusive = item.tax_inclusive;

    if (discount > 0) {
      if (!discountUOM) {
        discountUOM = "Amount";
        this.setData({ [`table_po.${index}.discount_uom`]: "Amount" });
      }
    }

    if (discountUOM) {
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
      } else {
        this.setData({ [`table_po.${index}.discount_uom`]: "" });
      }
    } else {
      this.setData({
        [`table_po.${index}.discount_amount`]: 0,
      });
    }

    const amountAfterDiscount = grossValue - discountAmount;

    let taxAmount = 0;
    let finalAmount = amountAfterDiscount;

    if (taxRate) {
      const taxRateDecimal = taxRate / 100;

      if (taxInclusive === 1) {
        taxAmount =
          amountAfterDiscount - amountAfterDiscount / (1 + taxRateDecimal);
        finalAmount = amountAfterDiscount;
      } else {
        taxAmount = amountAfterDiscount * taxRateDecimal;
        finalAmount = amountAfterDiscount + taxAmount;
      }

      // Set tax amount
      this.setData({
        [`table_po.${index}.tax_amount`]: parseFloat(taxAmount.toFixed(2)),
      });
    } else {
      this.setData({
        [`table_po.${index}.tax_amount`]: 0,
      });
    }

    this.setData({
      [`table_po.${index}.po_amount`]: parseFloat(finalAmount.toFixed(2)),
    });

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

    if (!exchangeRate) {
      return;
    } else {
      const myrTotalAmount = exchangeRate * totalAmount;
      this.setData({ myr_total_amount: parseFloat(myrTotalAmount.toFixed(2)) });
    }
  });
} else {
  console.log("Not an array:", items);
}
