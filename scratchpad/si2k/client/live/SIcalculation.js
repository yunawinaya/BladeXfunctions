console.log(this);

// SIcalculation — line amounts and header totals for the sales invoice.
//
// Item bundles sit in table_si as a parent row with the bundle's items as its
// children. Two shapes are handled, because the tree can arrive either way:
// nested under a `children` array, or flat rows pointing back at the parent via
// parent_id / parent_fm_key.
//
// A bundle parent carries no price, discount or tax of its own. All three are
// set per item and summed onto the parent, so editing a child's unit price,
// discount or tax rate moves the bundle line with it.
//
// This differs from the SO on purpose. On an order a child's quantity is what
// one bundle contains and the parent multiplies by the number of bundles sold.
// On an invoice the parent's invoice_qty drives the children's quantities, so a
// child already carries the full invoiced amount and the parent is the plain
// sum of its children — multiplying again would bill the bundle twice over.
// The unit price shown on the bundle row is that sum divided back out, i.e.
// what one bundle costs.
//
// The children are still priced so their own rows show an amount, but they
// never feed the header totals — that is the parent's job. Pricing a child
// writes its gross as well, which is what the bundle line above it is summed
// from.
//
// Inclusive and exclusive tax are summed separately: inclusive tax is already
// inside the line amount and must not be added to the total a second time.

// 1. 获取初始数据
const data = this.getValues();
const items = data.table_si || [];
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
  if (parseFloat(value) < 0) {
    return 0;
  }
  return parseFloat(value || 0);
};

// Get current row info
const currentRow = arguments[0]?.row;
const currentFmKey = currentRow?.fm_key;
const currentField = arguments[0]?.field;

const isChildOf = (row, parent) => {
  if (parent.id != null && row.parent_id != null) {
    if (String(row.parent_id) === String(parent.id)) return true;
  }

  if (parent.fm_key != null && row.parent_fm_key != null) {
    if (String(row.parent_fm_key) === String(parent.fm_key)) return true;
  }

  return false;
};

// Only bundle parents carry children. Returns each child row together with the
// setData path it is addressed by.
const getChildren = (rows, parent, parentIndex) => {
  if (Array.isArray(parent.children) && parent.children.length > 0) {
    return parent.children.map((child, childIndex) => ({
      row: child,
      path: `table_si.${parentIndex}.children.${childIndex}`,
      isNested: true,
    }));
  }

  const flatChildren = [];

  rows.forEach((row, index) => {
    if (index === parentIndex) return;
    if (!isChildOf(row, parent)) return;

    flatChildren.push({
      row,
      path: `table_si.${index}`,
      isNested: false,
    });
  });

  return flatChildren;
};

// accumulate === false prices the line for display only, leaving the header
// totals alone. bundleRollup is the sum of the bundle's items, and is what a
// bundle parent is costed from instead of its own price, discount and tax
// fields — all three are the items' business now.
//
// Returns the line's amounts as { gross, discountAmount, taxAmount, taxOnTop } —
// taxOnTop being the part added to the total, zero when the tax is inclusive.
const calculateLine = (item, path, accumulate, bundleRollup) => {
  const isBundleParent = bundleRollup !== undefined;

  // Check if this is the current row
  const isCurrentRow = currentRow && item.fm_key === currentFmKey;

  console.log("current row check", {
    path,
    itemFmKey: item.fm_key,
    currentFmKey,
    isCurrentRow,
  });

  // RECALCULATE ALL ROWS, not just the current one
  // But use the current row's new values from arguments[0].row for the current row
  let quantity, unitPrice, grossValue, discount, discountUOM, discountAmount;
  let taxRate, taxInclusive, taxAmount, taxOnTop, finalAmount;

  if (isCurrentRow) {
    // Use the row from arguments for current row (has latest values)
    const row = currentRow;
    quantity = Number(row.invoice_qty) || 0;
    unitPrice = quantity < 0 ? 0 : roundPrice(row.unit_price) || 0;
    grossValue = quantity * unitPrice;

    discount = parseFloat(row.si_discount) || 0;
    discountUOM = row.si_discount_uom_id;
    taxRate = Number(row.tax_percent) || 0;
    taxInclusive = row.si_tax_inclusive;

    // Update the current row's gross
    updates[`${path}.gross`] = roundPrice(grossValue);
    updates[`${path}.unit_price`] = roundPrice(unitPrice);
    if (currentField === "unit_price") {
      updates[`${path}.custom_fields`] = {
        ...row.custom_fields,
        kamco_unit_price: unitPrice,
      };

      updates[`${path}.trigger_calc`] = "No";
    }
  } else {
    // For non-current rows, use the values from the form data (which should be the latest)
    quantity = Number(item.invoice_qty) || 0;
    unitPrice = roundPrice(item.unit_price) || 0;
    grossValue = quantity * unitPrice;

    // IMPORTANT: Use the item's current values from the form
    discount = parseFloat(item.si_discount) || 0;
    discountUOM = item.si_discount_uom_id;
    taxRate = Number(item.tax_percent) || 0;
    taxInclusive = item.si_tax_inclusive;

    // A row that is not the one being edited still has to show its own gross.
    // Its discount, tax and amount were already being written here; the gross
    // beside them was not, so it sat at whatever it was last left at -- and on
    // a line that has never been priced, at nothing at all.
    //
    // A bundle's items feel this hardest. Changing how many bundles are
    // invoiced changes the quantity on every item under it, and an item is
    // never the row being edited, so its gross stayed blank while its amount
    // moved. The bundle line above them is the sum of their gross, so the
    // bundle read as though its items cost nothing.
    updates[`${path}.gross`] = roundPrice(grossValue);
  }

  if (isBundleParent) {
    // A bundle row shows what one bundle costs, worked back out of its items'
    // total so the row still reads as quantity * unit price. The gross is
    // written from the sum itself: the division only comes back to the same
    // figure when the number of bundles divides it evenly.
    grossValue = roundPrice(bundleRollup.gross);
    unitPrice = quantity > 0 ? roundPrice(bundleRollup.gross / quantity) : 0;

    updates[`${path}.unit_price`] = quantity < 0 ? 0 : unitPrice;
    updates[`${path}.gross`] = grossValue;
  }

  // Calculate discount (for ALL rows)
  discountAmount = 0;
  if (discount > 0 && !discountUOM) {
    discountUOM = "Amount";
    updates[`${path}.si_discount_uom_id`] = "Amount";
  }

  if (isBundleParent) {
    // A bundle row has no discount of its own — discount is set per item, and
    // the bundle's is what its items came to.
    discountAmount = roundPrice(bundleRollup.discountAmount);

    updates[`${path}.discount_amount`] = discountAmount;
  } else if (discountUOM && discount !== 0) {
    if (discountUOM === "Amount") {
      discountAmount = roundPrice(discount);
    } else if (discountUOM === "%") {
      discountAmount = roundPrice((grossValue * discount) / 100);
    }

    if (discountAmount > grossValue) {
      discountAmount = 0;
      updates[`${path}.si_discount`] = 0;
      updates[`${path}.discount_amount`] = 0;
    } else {
      updates[`${path}.discount_amount`] = roundPrice(discountAmount);
    }
  } else {
    updates[`${path}.discount_amount`] = 0;
  }

  const amountAfterDiscount = roundPrice(grossValue - discountAmount);

  // Calculate tax (for ALL rows)
  taxAmount = 0;
  taxOnTop = 0;
  finalAmount = amountAfterDiscount;

  if (isBundleParent) {
    // A bundle row has no rate of its own — the tax fields belong to the items
    // under it, and the bundle's tax is what theirs came to.
    taxAmount = roundPrice(bundleRollup.taxAmount);
    taxOnTop = roundPrice(bundleRollup.taxOnTop);
    finalAmount = amountAfterDiscount + taxOnTop;

    updates[`${path}.tax_amount`] = taxAmount;
  } else if (taxRate) {
    const taxRateDecimal = taxRate / 100;

    if (taxInclusive === 1) {
      taxAmount = roundPrice(
        amountAfterDiscount - amountAfterDiscount / (1 + taxRateDecimal),
      );
      finalAmount = amountAfterDiscount;
    } else {
      taxAmount = roundPrice(amountAfterDiscount * taxRateDecimal);
      taxOnTop = taxAmount;
      finalAmount = amountAfterDiscount + taxAmount;
    }

    updates[`${path}.tax_amount`] = roundPrice(taxAmount);
  } else {
    updates[`${path}.tax_amount`] = 0;
  }

  updates[`${path}.si_amount`] = roundPrice(finalAmount);

  if (!accumulate) {
    return {
      gross: roundPrice(grossValue),
      discountAmount,
      taxAmount,
      taxOnTop,
    };
  }

  // Add to totals (use the calculated values for ALL rows)
  totalGross += roundPrice(grossValue);
  totalDiscount += roundPrice(discountAmount);
  totalTax += roundPrice(taxAmount);
  totalAmount += roundPrice(finalAmount);

  console.log("Row calculation result", {
    path,
    isCurrentRow,
    grossValue,
    discountAmount,
    taxAmount,
    finalAmount,
  });
};

if (Array.isArray(items)) {
  // Pass 1 — roll each bundle's children up into its parent. Price, discount
  // and tax are all set per item, so all of them are summed here.
  const bundleRollup = new Map(); // parent index -> its items' amounts
  const rolledUpPaths = new Set(); // flat child rows the main loop must skip

  items.forEach((item, index) => {
    const children = getChildren(items, item, index);

    if (children.length === 0) {
      return;
    }

    let bundleGross = 0;
    let bundleDiscount = 0;
    let bundleTaxAmount = 0;
    let bundleTaxOnTop = 0;

    children.forEach((child) => {
      if (!child.isNested) {
        rolledUpPaths.add(child.path);
      }

      // Pricing the child also works out its own gross, discount and tax, which
      // is what the bundle is made of.
      const childAmounts = calculateLine(child.row, child.path, false);

      bundleGross += childAmounts.gross;
      bundleDiscount += childAmounts.discountAmount;
      bundleTaxAmount += childAmounts.taxAmount;
      bundleTaxOnTop += childAmounts.taxOnTop;
    });

    bundleRollup.set(index, {
      gross: roundPrice(bundleGross),
      discountAmount: roundPrice(bundleDiscount),
      taxAmount: roundPrice(bundleTaxAmount),
      taxOnTop: roundPrice(bundleTaxOnTop),
    });

    console.log(
      "item bundle line",
      item.item_bundle_id,
      "gross",
      roundPrice(bundleGross),
      "discount",
      roundPrice(bundleDiscount),
      "tax",
      roundPrice(bundleTaxAmount),
      "from",
      children.length,
      "children",
    );
  });

  // Pass 2 — normal calculation. Bundle parents cost from their rolled-up
  // amounts; rows already counted inside a bundle are skipped.
  items.forEach((item, index) => {
    const path = `table_si.${index}`;

    if (rolledUpPaths.has(path)) {
      return;
    }

    console.log("item", item);

    calculateLine(item, path, true, bundleRollup.get(index));
  });

  if (totalTax > 0) {
    this.display(["invoice_taxes_amount", "total_tax_currency"]);
  }

  updates["invoice_subtotal"] = roundPrice(totalGross);
  updates["invoice_total_discount"] = roundPrice(totalDiscount);
  updates["invoice_taxes_amount"] = roundPrice(totalTax);
  updates["invoice_total"] = roundPrice(totalAmount);

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
