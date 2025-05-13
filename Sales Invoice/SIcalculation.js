const data = this.getValues();
const items = data.table_si;
const exchangeRate = data.exchange_rate;
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;

if (Array.isArray(items)) {
  items.forEach((item, index) => {
    const quantity = Number(item.invoice_qty) || 0;
    const unitPrice = parseFloat(item.unit_price) || 0;
    const grossValue = quantity * unitPrice;

    totalGross += grossValue;

    this.setData({
      [`table_si.${index}.gross`]: grossValue,
      [`table_si.${index}.si_amount`]: grossValue,
      invoice_subtotal: totalGross,
    });

    let discount = parseFloat(item.si_discount) || 0;
    const discountUOM = item.si_discount_uom_id;
    let discountAmount = 0.0;
    const taxRate = Number(item.tax_rate_percent) || 0;
    const taxInclusive = item.si_tax_inclusive;

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
            [`table_si.${index}.si_discount`]: 0,
            [`table_si.${index}.discount_amount`]: 0,
          });
        } else {
          this.setData({
            [`table_si.${index}.discount_amount`]: parseFloat(
              discountAmount.toFixed(2)
            ),
          });
        }
      }
    } else {
      this.setData({
        [`table_si.${index}.discount_amount`]: 0,
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
        [`table_si.${index}.tax_amount`]: parseFloat(taxAmount.toFixed(2)),
      });
    } else {
      this.setData({
        [`table_si.${index}.tax_amount`]: 0,
      });
    }

    // Set final amount
    this.setData({
      [`table_si.${index}.si_amount`]: parseFloat(finalAmount.toFixed(2)),
    });

    totalDiscount += discountAmount;
    totalTax += taxAmount;
    totalAmount += finalAmount;

    if (totalTax > 0) {
      this.display(["invoice_taxes_amount", "total_tax_currency"]);
    }

    this.setData({
      invoice_total_discount: parseFloat(totalDiscount.toFixed(2)),
      invoice_taxes_amount: parseFloat(totalTax.toFixed(2)),
      invoice_total: parseFloat(totalAmount.toFixed(2)),
    });

    if (!exchangeRate) {
      return;
    } else {
      this.setData({
        myr_total_amount: exchangeRate * parseFloat(totalAmount.toFixed(2)),
      });
    }
  });
} else {
  console.log("Not an array:", items);
}
