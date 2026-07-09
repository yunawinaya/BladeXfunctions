console.log(this);

// 1. 获取初始数据
const data = this.getValues();
const items = data.table_so || [];
const exchangeRate = data.exchange_rate;
console.log("items", items);

// 2. 初始化计算变量
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;
const totalItems = items.length;

// 3. 创建更新收集器
const updates = {};

const roundPrice = (value) => {
  return parseFloat(parseFloat(value || 0).toFixed(4));
};

if (Array.isArray(items)) {
  if (totalItems > 0) {
    updates["partially_delivered"] = `0 / ${totalItems}`;
    updates["fully_delivered"] = `0 / ${totalItems}`;
  }

  items.forEach((item, index) => {
    console.log("item", item);

    // wzp 0527 修改：只识别当前失焦行
    const isCurrentRow =
      arguments[0] &&
      arguments[0].row &&
      (item.fm_key === arguments[0].row.fm_key ||
        index ===
          (arguments[0].rowIndex === undefined ? -1 : arguments[0].rowIndex));

    console.log("wzp 0527 修改 current row check", {
      index,
      itemFmKey: item.fm_key,
      argu: arguments[0],
      currentFmKey: arguments[0]?.row?.fm_key,
      rowIndex: arguments[0].rowIndex,
      isCurrentRow,
    });

    if (isCurrentRow) {
      // wzp 0527 修改：只有当前行用 arguments[0].row 最新值重新计算
      const row = arguments[0].row;

      const quantity = Number(row.so_quantity) || 0;
      const unitPrice = roundPrice(row.so_item_price) || 0;
      const grossValue = quantity * unitPrice;

      updates[`table_so.${index}.so_gross`] = roundPrice(grossValue);
      if (arguments[0].field === "so_item_price") {
        updates[`table_so.${index}.custom_fields.unit_price`] =
          row.so_item_price;
      }
      let discount = parseFloat(row.so_discount) || 0;
      let discountUOM = row.so_discount_uom;
      let discountAmount = 0.0;

      if (discount > 0 && !discountUOM) {
        discountUOM = "Amount";
        updates[`table_so.${index}.so_discount_uom`] = "Amount";
      }

      if (discountUOM && discount !== 0) {
        if (discountUOM === "Amount") {
          discountAmount = roundPrice(discount);
        } else if (discountUOM === "%") {
          discountAmount = roundPrice((grossValue * discount) / 100);
        }

        if (discountAmount > grossValue) {
          discountAmount = 0;
          updates[`table_so.${index}.so_discount`] = 0;
          updates[`table_so.${index}.so_discount_amount`] = 0;
        } else {
          updates[`table_so.${index}.so_discount_amount`] =
            roundPrice(discountAmount);
        }
      } else {
        updates[`table_so.${index}.so_discount_amount`] = 0;
      }

      const amountAfterDiscount = roundPrice(grossValue - discountAmount);
      const taxRate = Number(row.so_tax_percentage) || 0;
      const taxInclusive = row.so_tax_inclusive;

      let taxAmount = 0;
      let finalAmount = amountAfterDiscount;

      if (taxRate) {
        const taxRateDecimal = taxRate / 100;

        if (taxInclusive === 1) {
          taxAmount = roundPrice(
            amountAfterDiscount - amountAfterDiscount / (1 + taxRateDecimal),
          );
          finalAmount = amountAfterDiscount;
        } else {
          taxAmount = roundPrice(amountAfterDiscount * taxRateDecimal);
          finalAmount = amountAfterDiscount + taxAmount;
        }

        updates[`table_so.${index}.so_tax_amount`] = roundPrice(taxAmount);
      } else {
        updates[`table_so.${index}.so_tax_amount`] = 0;
      }

      updates[`table_so.${index}.so_amount`] = roundPrice(finalAmount);

      // wzp 0527 修改：当前行汇总用刚算出来的新值
      totalGross += roundPrice(grossValue);
      totalDiscount += roundPrice(discountAmount);
      totalTax += roundPrice(taxAmount);
      totalAmount += roundPrice(finalAmount);

      console.log("wzp 0527 修改 current row calc result", {
        index,
        grossValue,
        discountAmount,
        taxAmount,
        finalAmount,
      });
    } else {
      // wzp 0527 修改：非当前行不重算，只用已有字段参与主表合计
      totalGross += roundPrice(item.so_gross);
      totalDiscount += roundPrice(item.so_discount_amount);
      totalTax += roundPrice(item.so_tax_amount);
      totalAmount += roundPrice(item.so_amount);

      console.log("wzp 0527 修改 old row use exists", {
        index,
        so_gross: item.so_gross,
        so_discount_amount: item.so_discount_amount,
        so_tax_amount: item.so_tax_amount,
        so_amount: item.so_amount,
      });
    }
  });

  if (totalTax > 0) {
    this.display(["so_total_tax", "total_tax_currency"]);
  }

  updates["so_total_gross"] = roundPrice(totalGross);
  updates["so_total_discount"] = roundPrice(totalDiscount);
  updates["so_total_tax"] = roundPrice(totalTax);
  updates["so_total"] = roundPrice(totalAmount);

  if (exchangeRate) {
    const myrTotal = exchangeRate * totalAmount;
    updates["myr_total_amount"] = roundPrice(myrTotal);
  }

  console.log("gross 2:", totalGross);
  console.log("updates:", updates);
  console.log("models", this.models);

  console.log("Batch updating fields:", Object.keys(updates).length);
  this.setData(updates);

  setTimeout(() => {
    console.log("models 2", this.models);
    console.log("updates 2:", updates);
  }, 2000);

  return items;
} else {
  console.log("Not an array:", items);
  return items;
}
