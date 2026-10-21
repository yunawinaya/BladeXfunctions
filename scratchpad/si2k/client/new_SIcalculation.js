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
//
// A 2,000-line invoice: the flat rows under a bundle are found through an index
// built once, rows are not logged one by one, and only the line values that
// change are written (the header totals always are). A { rows: [...] } payload
// stands for one call per listed row, in that order, each row as the current
// row -- what row removal, the tax-inclusive switch and Batch Add used to fire
// as one full recalculation per row.

// 1. 获取初始数据
const data = this.getValues();
const items = data.table_si || [];
const exchangeRate = data.exchange_rate;
console.log("items", items);

const roundPrice = (value) => {
  if (parseFloat(value) < 0) {
    return 0;
  }
  return parseFloat(value || 0);
};

// Only bundle parents carry children. Returns each child row together with the
// setData path it is addressed by. The flat rows pointing back at a parent are
// indexed once (by parent_id and parent_fm_key) rather than scanned for every row.
const flatChildIndex = (rows) => {
  const byParentId = new Map();
  const byParentKey = new Map();

  rows.forEach((row, index) => {
    if (row.parent_id != null) {
      const k = String(row.parent_id);
      if (!byParentId.has(k)) byParentId.set(k, []);
      byParentId.get(k).push(index);
    }

    if (row.parent_fm_key != null) {
      const k = String(row.parent_fm_key);
      if (!byParentKey.has(k)) byParentKey.set(k, []);
      byParentKey.get(k).push(index);
    }
  });

  return { byParentId, byParentKey };
};

const getChildren = (rows, parent, parentIndex, index) => {
  if (Array.isArray(parent.children) && parent.children.length > 0) {
    return parent.children.map((child, childIndex) => ({
      row: child,
      path: `table_si.${parentIndex}.children.${childIndex}`,
      isNested: true,
    }));
  }

  const found = new Set([
    ...(parent.id != null ? index.byParentId.get(String(parent.id)) || [] : []),
    ...(parent.fm_key != null ? index.byParentKey.get(String(parent.fm_key)) || [] : []),
  ]);
  found.delete(parentIndex);

  return [...found]
    .sort((a, b) => a - b)
    .map((i) => ({
      row: rows[i],
      path: `table_si.${i}`,
      isNested: false,
    }));
};

// accumulate === false prices the line for display only, leaving the header
// totals alone. bundleRollup is the sum of the bundle's items, and is what a
// bundle parent is costed from instead of its own price, discount and tax
// fields — all three are the items' business now.
//
// Returns the line's amounts as { gross, discountAmount, taxAmount, taxOnTop } —
// taxOnTop being the part added to the total, zero when the tax is inclusive.
const calculateLine = (ctx, item, path, accumulate, bundleRollup) => {
  const { updates, currentRow, currentFmKey, currentField, totals } = ctx;
  const isBundleParent = bundleRollup !== undefined;

  if (ctx.visits) ctx.visits.push({ item, path, bundle: isBundleParent });

  // Check if this is the current row
  const isCurrentRow = currentRow && item.fm_key === currentFmKey;

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
  totals.gross += roundPrice(grossValue);
  totals.discount += roundPrice(discountAmount);
  totals.tax += roundPrice(taxAmount);
  totals.amount += roundPrice(finalAmount);
};

// One full pricing of the table as it stands, with currentRow (if any) as the
// row being edited. Returns every line value and the header totals.
const priceTable = (rows, currentRow, currentField, visits) => {
  const ctx = {
    updates: {},
    currentRow,
    currentFmKey: currentRow?.fm_key,
    currentField,
    totals: { gross: 0, discount: 0, tax: 0, amount: 0 },
    visits: visits || null,
  };

  // Pass 1 — roll each bundle's children up into its parent. Price, discount
  // and tax are all set per item, so all of them are summed here.
  const bundleRollup = new Map(); // parent index -> its items' amounts
  const rolledUpPaths = new Set(); // flat child rows the main loop must skip
  const childIndex = flatChildIndex(rows);

  rows.forEach((item, index) => {
    const children = getChildren(rows, item, index, childIndex);

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
      const childAmounts = calculateLine(ctx, child.row, child.path, false);

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
  });

  // Pass 2 — normal calculation. Bundle parents cost from their rolled-up
  // amounts; rows already counted inside a bundle are skipped.
  rows.forEach((item, index) => {
    const path = `table_si.${index}`;

    if (rolledUpPaths.has(path)) {
      return;
    }

    calculateLine(ctx, item, path, true, bundleRollup.get(index));
  });

  const updates = ctx.updates;
  updates["invoice_subtotal"] = roundPrice(ctx.totals.gross);
  updates["invoice_total_discount"] = roundPrice(ctx.totals.discount);
  updates["invoice_taxes_amount"] = roundPrice(ctx.totals.tax);
  updates["invoice_total"] = roundPrice(ctx.totals.amount);

  if (exchangeRate) {
    const myrTotal = exchangeRate * ctx.totals.amount;
    updates["myr_total_amount"] = roundPrice(myrTotal);
  }

  return { updates, totalTax: ctx.totals.tax };
};

// { rows: [r1 ... rN] } — the outcome of N calls, call k with rk as the current
// row. Each call priced every line and wrote it, so the line values and totals
// that stand are the last call's; what an earlier call left behind is only what
// it wrote onto a row's own inputs (the current row's unit price, a discount
// cleared or given its "Amount" unit), and the last call priced from those. So
// each row's inputs are carried through the calls that touch them, and the
// table is priced once, with rN current.
const priceForRows = (rows) => {
  const state = JSON.parse(JSON.stringify(items));
  const visits = [];
  priceTable(state, undefined, undefined, visits);

  const last = rows.length - 1;
  const callsByKey = new Map(); // fm_key -> the earlier calls that row was current in
  rows.forEach((row, call) => {
    if (!row || call === last) return;
    if (!callsByKey.has(row.fm_key)) callsByKey.set(row.fm_key, []);
    callsByKey.get(row.fm_key).push(call);
  });

  const ZERO = { gross: 0, discountAmount: 0, taxAmount: 0, taxOnTop: 0 };
  const carried = {};
  const seen = new Set();

  // What one call wrote onto this row's inputs, applied to the row.
  const carry = (visit, currentRow) => {
    const scratch = {
      updates: {},
      currentRow,
      currentFmKey: currentRow?.fm_key,
      currentField: undefined,
      totals: { gross: 0, discount: 0, tax: 0, amount: 0 },
      visits: null,
    };
    calculateLine(scratch, visit.item, visit.path, false, visit.bundle ? ZERO : undefined);

    const fields = ["si_discount_uom_id", "si_discount", "custom_fields", "trigger_calc"];
    if (!visit.bundle) fields.push("unit_price");

    for (const field of fields) {
      const key = `${visit.path}.${field}`;
      if (!(key in scratch.updates)) continue;
      carried[key] = scratch.updates[key];
      visit.item[field] = scratch.updates[key];
    }
  };

  for (const visit of visits) {
    if (seen.has(visit.path)) continue;
    seen.add(visit.path);

    const calls = callsByKey.get(visit.item.fm_key) || [];
    let done = -1;

    for (const call of calls) {
      if (call > done + 1) carry(visit, null); // the calls in between, this row not current
      carry(visit, rows[call]);
      done = call;
    }

    if (last > done + 1) carry(visit, null);
  }

  const { updates, totalTax } = priceTable(state, rows[last], undefined);
  const firstTax = last > 0 ? priceTable(items, rows[0], undefined).totalTax : totalTax;

  return { updates: Object.assign(carried, updates), showTax: totalTax > 0 || firstTax > 0 };
};

if (Array.isArray(items)) {
  const payload = arguments[0];
  const batch = Array.isArray(payload?.rows) ? payload.rows : null;

  if (batch && batch.length === 0) {
    return items;
  }

  let updates;
  let showTax;

  if (batch) {
    ({ updates, showTax } = priceForRows(batch));
  } else {
    const priced = priceTable(items, payload?.row, payload?.field);
    updates = priced.updates;
    showTax = priced.totalTax > 0;
  }

  if (showTax) {
    this.display(["invoice_taxes_amount", "total_tax_currency"]);
  }

  // Line values are written only where they change; the header totals always.
  const currentAt = (path) =>
    path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), data);
  const changed = {};

  for (const [path, value] of Object.entries(updates)) {
    if (!path.startsWith("table_si.") || currentAt(path) !== value) {
      changed[path] = value;
    }
  }

  console.log("updates:", changed);
  console.log("Batch updating fields:", Object.keys(changed).length);
  this.setData(changed);

  return items;
} else {
  console.log("Not an array:", items);
  return items;
}
