// PIcalculation — line amounts and header totals for the purchase invoice.
//
// Item bundles sit in table_pi as a parent row with the bundle's items as its
// children. Two shapes are handled, because the tree can arrive either way:
// nested under a `children` array, or flat rows pointing back at the parent via
// parent_id / parent_fm_key.
//
// A bundle parent carries no price, discount or tax of its own. All three are
// set per item and summed onto the parent, so editing a child's unit price,
// discount or tax rate moves the bundle line with it.
//
// This differs from the PO on purpose. On a PO a child's quantity is what one
// bundle contains and the parent multiplies by the number of bundles ordered.
// On an invoice the parent's invoice_qty drives the children's quantities, so a
// child already carries the full invoiced amount and the parent is the plain
// sum of its children — multiplying again would bill the bundle twice over.
// The unit price shown on the bundle row is that sum divided back out, i.e.
// what one bundle costs.
//
// The children are still priced so their own rows show an amount, but they
// never feed the header totals — that is the parent's job.
//
// Inclusive and exclusive tax are summed separately: inclusive tax is already
// inside the line amount and must not be added to the total a second time.

const data = this.getValues();
let items = [];

const roundPrice = (value) => {
  if (parseFloat(value) < 0) {
    return 0;
  }
  return parseFloat(value || 0);
};

if (data.table_pi.length > 0) {
  items = data.table_pi;
} else {
  const { PIlineItem } = arguments[0];
  items = PIlineItem;
}
const exchangeRate = data.exchange_rate;
const updatedData = {};
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;

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
      path: `table_pi.${parentIndex}.children.${childIndex}`,
      isNested: true,
    }));
  }

  const flatChildren = [];

  rows.forEach((row, index) => {
    if (index === parentIndex) return;
    if (!isChildOf(row, parent)) return;

    flatChildren.push({
      row,
      path: `table_pi.${index}`,
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
  const quantity = Number(item.invoice_qty) || 0;

  // A bundle row shows what one bundle costs, worked back out of its items'
  // total so the row still reads as quantity * unit price.
  const unitPrice = isBundleParent
    ? quantity > 0
      ? roundPrice(bundleRollup.gross / quantity)
      : 0
    : roundPrice(item.order_unit_price) || 0;

  const grossValue = isBundleParent
    ? roundPrice(bundleRollup.gross)
    : quantity * unitPrice;

  if (accumulate) {
    totalGross += roundPrice(grossValue);
    updatedData["invoice_subtotal"] = roundPrice(totalGross);
  }

  updatedData[`${path}.order_unit_price`] = quantity < 0 ? 0 : unitPrice;
  updatedData[`${path}.order_gross`] = roundPrice(grossValue);
  updatedData[`${path}.invoice_amount`] = roundPrice(grossValue);

  let discount = parseFloat(item.order_discount) || 0;
  let discountUOM = item.discount_uom;
  let discountAmount = 0.0;
  const taxRate = Number(item.tax_percent) || 0;
  const taxInclusive = item.tax_inclusive;

  if (discount > 0) {
    if (!discountUOM) {
      discountUOM = "Amount";
      updatedData[`${path}.discount_uom`] = "Amount";
    }
  }

  if (isBundleParent) {
    // A bundle row has no discount of its own — discount is set per item, and
    // the bundle's is what its items came to.
    discountAmount = roundPrice(bundleRollup.discountAmount);

    updatedData[`${path}.discount_amount`] = discountAmount;
  } else if (discountUOM) {
    if (discount !== 0) {
      if (discountUOM === "Amount") {
        discountAmount = roundPrice(discount);
      } else if (discountUOM === "%") {
        discountAmount = roundPrice((grossValue * discount) / 100);
      }

      if (discountAmount > grossValue) {
        discount = 0;
        discountAmount = 0;

        updatedData[`${path}.order_discount`] = 0;
        updatedData[`${path}.discount_amount`] = 0;
      } else {
        updatedData[`${path}.discount_amount`] = roundPrice(discountAmount);
      }
    }
  } else {
    updatedData[`${path}.discount_amount`] = 0;
  }

  const amountAfterDiscount = roundPrice(grossValue - discountAmount);

  let taxAmount = 0;
  let taxOnTop = 0;
  let finalAmount = amountAfterDiscount;

  if (isBundleParent) {
    // A bundle row has no rate of its own — the tax fields belong to the items
    // under it, and the bundle's tax is what theirs came to.
    taxAmount = roundPrice(bundleRollup.taxAmount);
    taxOnTop = roundPrice(bundleRollup.taxOnTop);
    finalAmount = amountAfterDiscount + taxOnTop;

    updatedData[`${path}.tax_amount`] = taxAmount;
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

    updatedData[`${path}.tax_amount`] = taxAmount;
  } else {
    updatedData[`${path}.tax_amount`] = 0;
  }

  // Set final amount
  updatedData[`${path}.invoice_amount`] = roundPrice(finalAmount);

  if (!accumulate) {
    return {
      gross: roundPrice(grossValue),
      discountAmount,
      taxAmount,
      taxOnTop,
    };
  }

  // Subtract previous values before adding new ones
  totalDiscount += roundPrice(discountAmount);
  totalTax += roundPrice(taxAmount);
  totalAmount += roundPrice(finalAmount);

  if (totalTax > 0) {
    this.display(["invoice_taxes_amount", "total_tax_currency"]);
  }

  updatedData["invoice_total_discount"] = roundPrice(totalDiscount);
  updatedData["invoice_taxes_amount"] = roundPrice(totalTax);
  updatedData["invoice_total"] = roundPrice(totalAmount);

  if (exchangeRate) {
    const myrTotalAmount = (exchangeRate || 1) * totalAmount;
    updatedData["myr_total_amount"] = roundPrice(myrTotalAmount);
  }
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
    const path = `table_pi.${index}`;

    if (rolledUpPaths.has(path)) {
      return;
    }

    calculateLine(item, path, true, bundleRollup.get(index));
  });

  this.setData(updatedData);
} else {
  console.log("Not an array:", items);
}
