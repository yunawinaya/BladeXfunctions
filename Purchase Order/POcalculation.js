// POcalculation — line amounts and header totals for the PO.
//
// Item bundles sit in table_po as a parent row with the bundle's items as its
// children. Two shapes are handled, because the tree can arrive either way:
// nested under a `children` array, or flat rows pointing back at the parent via
// parent_id / parent_fm_key.
//
// A bundle parent carries no price of its own. Its items already hold the whole
// quantity asked for — ordering 2 of a bundle holding 3 of an item puts 6 on
// that item's row, which is what onBlur_quantity spreads — so what the bundle
// comes to is simply their sum. That sum is the parent's gross, and its unit
// price is that sum over the number of bundles: what one bundle costs.
//
// The gross is written from the sum itself rather than recomputed as quantity *
// unit price, since the division only comes back to the same figure when it
// divides evenly. The children are still priced so their own rows show an
// amount, but they never feed the header totals — that is the parent's job, and
// counting both would bill the bundle twice.
//
// Discount and tax work the same way. Both are set per item, never on the bundle
// row, and the items are already costed at the full quantity, so the bundle's
// are their plain sum. Inclusive and exclusive tax are summed separately:
// inclusive tax is already inside the rolled-up price and must not be added to
// the total a second time.
//
// { calcRows }: cost those rows in place, return the header; else once a tick.

const args = arguments[0] || {};
const calcRows = Array.isArray(args.calcRows) ? args.calcRows : null;

if (!calcRows && !args.poCalcNow) {
  if (!this.__poCalcQueued) {
    this.__poCalcQueued = true;
    this.$nextTick(() => {
      this.__poCalcQueued = false;
      this.triggerEvent("POcalculation", { poCalcNow: true });
    });
  }
  return;
}

const items = calcRows || this.getValue("table_po");
const exchangeRate = this.getValue("exchange_rate");
const updatedData = {};
const targets = new Map(); // setData path -> the row and field it writes
let totalGross = 0;
let totalDiscount = 0;
let totalTax = 0;
let totalAmount = 0;
let totalItems = items.length;
let showTax = false;

const roundPrice = (value) => {
  return parseFloat(value || 0);
};

const put = (path, row, field, value) => {
  updatedData[`${path}.${field}`] = value;
  targets.set(`${path}.${field}`, { row, field });
};

// Flat children by their parent's id / fm_key, looked up once per bundle.
const byParentId = new Map();
const byParentKey = new Map();

if (Array.isArray(items)) {
  items.forEach((row, index) => {
    [
      [byParentId, row.parent_id],
      [byParentKey, row.parent_fm_key],
    ].forEach(([map, key]) => {
      if (key == null) return;
      if (!map.has(String(key))) map.set(String(key), []);
      map.get(String(key)).push(index);
    });
  });
}

// Only bundle parents carry children. Returns each child row together with the
// setData path it is addressed by — its fm_key, which is what identifies a row
// wherever it sits in the tree, falling back to its position. `index` is the
// child's own place in table_po when it is a row of its own, so the main loop
// below knows to skip it; null when it is nested under its parent and never
// reaches that loop.
const getChildren = (rows, parent, parentIndex) => {
  if (Array.isArray(parent.children) && parent.children.length > 0) {
    return parent.children.map((child, childIndex) => ({
      row: child,
      path: child.fm_key
        ? `table_po.${child.fm_key}`
        : `table_po.${parentIndex}.children.${childIndex}`,
      index: null,
    }));
  }

  const found = new Set([
    ...(parent.id != null ? byParentId.get(String(parent.id)) || [] : []),
    ...(parent.fm_key != null
      ? byParentKey.get(String(parent.fm_key)) || []
      : []),
  ]);

  found.delete(parentIndex);

  return [...found]
    .sort((a, b) => a - b)
    .map((index) => ({
      row: rows[index],
      path: rows[index].fm_key
        ? `table_po.${rows[index].fm_key}`
        : `table_po.${index}`,
      index,
    }));
};

// accumulate === false prices the line for display only, leaving the header
// totals alone. bundleRollup is what the bundle's items come to, and is what a
// bundle parent is costed from instead of its own price, discount and tax
// fields — all three are the items' business now.
//
// Returns the line's amounts as { discountAmount, taxAmount, taxOnTop } —
// taxOnTop being the part added to the total, zero when the tax is inclusive.
const calculateLine = (item, path, accumulate, bundleRollup) => {
  const quantity = Number(item.quantity) || 0;
  const unitPrice =
    bundleRollup === undefined
      ? roundPrice(item.unit_price) || 0
      : bundleRollup.unitPrice;
  // A bundle's gross is what its items come to, taken as it stands. Working it
  // back out of the unit price would only return the same figure when the
  // number of bundles divides that sum evenly.
  const grossValue =
    bundleRollup === undefined ? quantity * unitPrice : bundleRollup.grossValue;

  if (accumulate) {
    if (totalItems > 0) {
      updatedData["partially_received"] = `0 / ${totalItems}`;
      updatedData["fully_received"] = `0 / ${totalItems}`;
    }

    totalGross += roundPrice(grossValue);
  }

  put(path, item, "gross", roundPrice(grossValue));
  put(path, item, "po_amount", roundPrice(grossValue));

  if (accumulate) {
    updatedData["po_total_gross"] = roundPrice(totalGross);
  }

  let discount = parseFloat(item.discount) || 0;
  let discountUOM = item.discount_uom;
  let discountAmount = 0.0;
  const taxRate = Number(item.tax_percent) || 0;
  const taxInclusive = item.tax_inclusive;

  if (discount > 0) {
    if (!discountUOM) {
      discountUOM = "Amount";
      put(path, item, "discount_uom", "Amount");
    }
  }

  if (bundleRollup !== undefined) {
    // A bundle row has no discount of its own — discount is set per item, and
    // the items are already costed at the full quantity, so the bundle's is
    // their sum.
    discountAmount = bundleRollup.discountAmount;

    put(path, item, "discount_amount", discountAmount);
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

        put(path, item, "discount", 0);
        put(path, item, "discount_amount", 0);
      } else {
        put(path, item, "discount_amount", roundPrice(discountAmount));
      }
    }
  } else {
    put(path, item, "discount_amount", 0);
  }

  const amountAfterDiscount = roundPrice(grossValue - discountAmount);

  let taxAmount = 0;
  let taxOnTop = 0;
  let finalAmount = amountAfterDiscount;

  if (bundleRollup !== undefined) {
    // A bundle row has no rate of its own — the tax fields belong to the items
    // under it, and they are already taxed at the full quantity, so the
    // bundle's is their sum.
    taxAmount = bundleRollup.taxAmount;
    taxOnTop = bundleRollup.taxOnTop;
    finalAmount = amountAfterDiscount + taxOnTop;

    put(path, item, "tax_amount", taxAmount);
  } else if (taxRate) {
    const taxRateDecimal = taxRate / 100;

    if (taxInclusive === 1) {
      taxAmount = roundPrice(
        amountAfterDiscount - amountAfterDiscount / (1 + taxRateDecimal)
      );
      finalAmount = amountAfterDiscount;
    } else {
      taxAmount = roundPrice(amountAfterDiscount * taxRateDecimal);
      taxOnTop = taxAmount;
      finalAmount = amountAfterDiscount + taxAmount;
    }

    // Set tax amount
    put(path, item, "tax_amount", taxAmount);
  } else {
    put(path, item, "tax_amount", 0);
  }

  put(path, item, "po_amount", roundPrice(finalAmount));

  if (!accumulate) {
    return { discountAmount, taxAmount, taxOnTop };
  }

  totalDiscount += roundPrice(discountAmount);
  totalTax += roundPrice(taxAmount);
  totalAmount += roundPrice(finalAmount);

  if (totalTax > 0) {
    showTax = true;
  }

  // Set the total fields
  updatedData["po_total_discount"] = roundPrice(totalDiscount);
  updatedData["po_total_tax"] = roundPrice(totalTax);
  updatedData["po_total"] = roundPrice(totalAmount);

  if (!exchangeRate) {
    return;
  } else {
    const myrTotalAmount = exchangeRate * totalAmount;
    updatedData["myr_total_amount"] = roundPrice(myrTotalAmount);
  }
};

if (Array.isArray(items)) {
  // Pass 1 — roll each bundle's children up into its parent. Price, discount and
  // tax are all set per item, so all three are summed here.
  const bundleRollup = new Map(); // parent index -> what its items come to
  const rolledUpIndexes = new Set(); // child rows of their own the main loop skips

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
      const childQty = Number(child.row.quantity) || 0;
      const childUnitPrice = roundPrice(child.row.unit_price);

      bundleGross += roundPrice(childQty * childUnitPrice);

      if (child.index !== null) {
        rolledUpIndexes.add(child.index);
      }

      // Pricing the child also works out its own discount and tax, which is
      // what the bundle's are made of.
      const childAmounts = calculateLine(child.row, child.path, false);

      bundleDiscount += childAmounts.discountAmount;
      bundleTaxAmount += childAmounts.taxAmount;
      bundleTaxOnTop += childAmounts.taxOnTop;
    });

    // What one bundle costs, worked back out of what its items come to. A line
    // asking for no bundles has nothing under it to price, so it shows nothing
    // rather than a division by zero.
    const bundleQty = Number(item.quantity) || 0;
    const bundleUnitPrice =
      bundleQty > 0 ? roundPrice(bundleGross / bundleQty) : 0;

    bundleRollup.set(index, {
      unitPrice: bundleUnitPrice,
      grossValue: roundPrice(bundleGross),
      discountAmount: roundPrice(bundleDiscount),
      taxAmount: roundPrice(bundleTaxAmount),
      taxOnTop: roundPrice(bundleTaxOnTop),
    });
    put(`table_po.${index}`, item, "unit_price", bundleUnitPrice);

    console.log(
      "item bundle line",
      item.item_bundle_id,
      "gross",
      roundPrice(bundleGross),
      "over",
      bundleQty,
      "bundles = unit price",
      bundleUnitPrice,
      "discount",
      roundPrice(bundleDiscount),
      "tax",
      roundPrice(bundleTaxAmount),
      "from",
      children.length,
      "children"
    );
  });

  // A bundle is one receivable line: its children are rolled into the parent,
  // so they must not inflate the received counters. In the nested shape the
  // children are not rows of table_po at all and the set is empty.
  totalItems = items.length - rolledUpIndexes.size;

  // Pass 2 — normal calculation. Bundle parents cost from their rolled-up
  // amounts; rows already counted inside a bundle are skipped.
  items.forEach((item, index) => {
    const path = `table_po.${index}`;

    if (rolledUpIndexes.has(index)) {
      return;
    }

    calculateLine(item, path, true, bundleRollup.get(index));
  });

  if (showTax) {
    this.display(["po_total_tax", "total_tax_currency"]);
  }

  const header = {};
  const changed = {};

  Object.keys(updatedData).forEach((key) => {
    const target = targets.get(key);

    if (!target) {
      header[key] = changed[key] = updatedData[key];
    } else if (calcRows) {
      target.row[target.field] = updatedData[key];
    } else if (!Object.is(target.row[target.field], updatedData[key])) {
      changed[key] = updatedData[key];
    }
  });

  if (calcRows) return header;

  this.setData(changed);
} else {
  console.log("Not an array:", items);
}