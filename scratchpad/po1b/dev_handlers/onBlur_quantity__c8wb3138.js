// A bundle row is not an item: its quantity is the number of bundles asked for.
//
// Parent quantity changes: child quantity = parent quantity × bundle_ratio.
// Child quantity changes: bundle_ratio = child quantity ÷ parent quantity.
//
// Original children (item_bundle_id + parent) keep the bundle's price, so they
// never run the price-history workflow. Manual children (parent, no
// item_bundle_id) carry their own price and run it like a normal item.

const event = arguments[0] || {};

const lineIndex = event.index ?? event.rowIndex;
const targetRow = event.row?.fm_key ?? lineIndex;

const roundQty = (value) => parseFloat(value) || 0;

const referenceId = (value) => {
  if (value && typeof value === "object") return value.id || null;
  return value || null;
};

// Mirrors isChildOf / getChildren in POcalculation: the tree arrives either
// nested under `children` or as flat rows pointing back at the parent. Each
// child comes back with the path that addresses it -- by fm_key, since that is
// what identifies a row, with its position as a fallback.
const getBundleChildren = (rows, parent, parentIndex) => {
  if (Array.isArray(parent.children) && parent.children.length > 0) {
    return parent.children.map((child, childIndex) => ({
      row: child,
      path: child.fm_key
        ? `table_po.${child.fm_key}`
        : `table_po.${parentIndex}.children.${childIndex}`,
    }));
  }

  const isChildOf = (row) => {
    if (parent.id != null && row.parent_id != null) {
      if (String(row.parent_id) === String(parent.id)) return true;
    }

    if (parent.fm_key != null && row.parent_fm_key != null) {
      if (String(row.parent_fm_key) === String(parent.fm_key)) return true;
    }

    return false;
  };

  const flatChildren = [];

  rows.forEach((row, index) => {
    if (index === parentIndex) return;
    if (!isChildOf(row)) return;

    flatChildren.push({
      row,
      path: row.fm_key ? `table_po.${row.fm_key}` : `table_po.${index}`,
    });
  });

  return flatChildren;
};

// Per-bundle quantities from the bundle definition, keyed by item in the order
// the bundle lists them. Only used for original children that have no
// bundle_ratio yet (lines added before bundle_ratio existed).
const fetchBundleQuantities = async (bundleId) => {
  if (!bundleId) return null;

  const resBundle = await db.collection("item_bundle").doc(bundleId).get();
  const bundleLines = resBundle?.data?.[0]?.table_ib || [];

  if (bundleLines.length === 0) {
    console.log("item bundle has no lines", bundleId);

    return null;
  }

  const byItem = new Map();

  for (const line of bundleLines) {
    const key = String(line.item_id ?? "");

    if (!byItem.has(key)) byItem.set(key, []);

    byItem.get(key).push(parseFloat(line.quantity) || 0);
  }

  return byItem;
};

const spreadBundleQuantity = async (changedRow, rowIndex) => {
  const rows = this.getValue("table_po") || [];

  const parentIndex = rows.findIndex((row) =>
    changedRow.fm_key != null
      ? String(row.fm_key) === String(changedRow.fm_key)
      : false,
  );

  const parent = parentIndex === -1 ? changedRow : rows[parentIndex];
  const anchorIndex = parentIndex === -1 ? rowIndex : parentIndex;
  const children = getBundleChildren(rows, parent, anchorIndex);

  if (children.length === 0) {
    console.log("item bundle line has no items", parent.item_bundle_id);

    return;
  }

  // The row handed over carries the quantity just typed; the copy read back
  // may still hold the old one.
  const bundles = parseFloat(changedRow.quantity) || 0;

  const needsDefinition = children.some(
    ({ row }) => row.bundle_ratio == null && !!row.item_bundle_id,
  );

  const perBundle = needsDefinition
    ? await fetchBundleQuantities(referenceId(parent.item_bundle_id))
    : null;

  const taken = new Map();
  const updates = {};

  for (const { row, path } of children) {
    if (row.bundle_ratio != null) {
      const ratio = Number(row.bundle_ratio) || 0;

      updates[`${path}.quantity`] = roundQty(bundles * ratio);
      continue;
    }

    if (!row.item_bundle_id) {
      console.log("manual bundle child has no bundle_ratio", path);
      continue;
    }

    const key = String(row.item_id ?? "");
    const quantities = perBundle?.get(key) || [];
    const position = taken.get(key) || 0;

    taken.set(key, position + 1);

    if (position >= quantities.length) {
      console.log("no bundle line for item", key, "on", parent.item_bundle_id);
      continue;
    }

    updates[`${path}.quantity`] = roundQty(quantities[position] * bundles);
    updates[`${path}.bundle_ratio`] = quantities[position];
  }

  if (Object.keys(updates).length === 0) return;

  console.log("item bundle line", parent.item_bundle_id, bundles, "bundles", updates);

  await this.setData(updates);
  await this.triggerEvent("POcalculation");
};

const findParentRow = (rows, childRow) => {
  for (const row of rows || []) {
    if (childRow.parent_fm_key != null && row.fm_key != null) {
      if (String(row.fm_key) === String(childRow.parent_fm_key)) return row;
    } else if (childRow.parent_id != null && row.id != null) {
      if (String(row.id) === String(childRow.parent_id)) return row;
    }

    const found = findParentRow(row.children, childRow);

    if (found) return found;
  }

  return null;
};

(async () => {
  const changedRow = event.row || {};

  const isBundleChildRow =
    changedRow.parent_fm_key != null || changedRow.parent_id != null;

  const isBundleParentRow = !!changedRow.item_bundle_id && !isBundleChildRow;

  const isManualChildRow = isBundleChildRow && !changedRow.item_bundle_id;

  // Parent quantity of the edited child, kept so the workflow's Overwrite
  // below can re-derive bundle_ratio when it replaces the child's quantity.
  let bundleParentQty = 0;

  if (isBundleParentRow || isBundleChildRow) {
    // The UOM onChange also lands here. A manual child still has to reach
    // the workflow on a UOM change, the same as a normal item does.
    if (event.field !== "quantity" && !isManualChildRow) {
      return;
    }

    if (isBundleParentRow) {
      await spreadBundleQuantity(changedRow, event.rowIndex);

      return;
    }

    const parent = findParentRow(this.getValue("table_po") || [], changedRow);

    if (!parent) {
      console.warn("Bundle parent not found", changedRow);
      return;
    }

    const parentQty = Number(parent.quantity) || 0;
    bundleParentQty = parentQty;

    // Only a quantity change moves the ratio; a UOM change leaves it alone.
    if (event.field === "quantity" && parentQty > 0) {
      const childQty = Number(changedRow.quantity) || 0;

      await this.setData({
        [`table_po.${targetRow}.bundle_ratio`]: childQty / parentQty,
      });
    }

    if (!isManualChildRow) {
      return;
    }
  }

  const quantity = changedRow.quantity;
  const minQty = parseFloat(changedRow.min_qty) || 0;
  const maxQty = parseFloat(changedRow.max_qty) || 0;
  let callWorkflow = false;

  if (changedRow.from_historical === 0) {
    if (event.field === "quantity") {
      if((minQty > 0 && quantity < minQty) || (maxQty > 0 && quantity > maxQty)){
        console.log("PO Quantity out of range, skip workflow");
        return;
      }
      callWorkflow = true;
    } else if (event.field === "quantity_uom") {
      callWorkflow = true;
    }
  }

  if (callWorkflow) {
    const supplierID = this.getValue("po_supplier_id");
    const plantID = this.getValue("po_plant");

    await this.runWorkflow(
      "2067818102244966401",
      {
        document_type: "PO",
        supp_cust_id: supplierID,
        plant_id: plantID,
        item_data: [
          {
            item_id: changedRow.item_id,
            unit_price: changedRow.unit_price,
            line_index: lineIndex,
            uom_id: changedRow.quantity_uom,
            tax_rate: changedRow.tax_preference || null,
            tax_percent: changedRow.tax_percent || null,
            quantity: changedRow.quantity,
            discount: changedRow.discount,
            discount_uom: changedRow.discount_uom,
          },
        ],
      },
      async (result) => {
        console.log("result", result);
        const updates = {};

        if (result.data.needOverwrite === "No") {
          for (const item of result.data.data) {
            updates[`table_po.${targetRow}.max_price`] = item.max_price;
            updates[`table_po.${targetRow}.min_price`] = item.min_price;
            updates[`table_po.${targetRow}.min_qty`] = item.min_qty;
            updates[`table_po.${targetRow}.max_qty`] = item.max_qty;
          }

          await this.setData(updates);
          return;
        }

        await this.$confirm(
          "Multipricing found for this item. Do you want to use it?",
          "Confirmation",
          {
            confirmButtonText: "Overwrite",
            cancelButtonText: "Keep",
            dangerouslyUseHTMLString: true,
            type: "info",
            distinguishCancelAndClose: true,

            beforeClose: async (action, instance, done) => {
              if (action === "confirm") {
                for (const item of result.data.data) {
                  updates[`table_po.${targetRow}.unit_price`] =
                    item.unit_price;
                  updates[`table_po.${targetRow}.quantity_uom`] =
                    item.uom_id;
                  updates[`table_po.${targetRow}.tax_preference`] =
                    item.tax_rate;
                  updates[`table_po.${targetRow}.tax_percent`] =
                    item.tax_percent;
                  updates[`table_po.${targetRow}.from_historical`] =
                    item.from_historical;
                  updates[`table_po.${targetRow}.max_price`] =
                    item.max_price;
                  updates[`table_po.${targetRow}.min_price`] =
                    item.min_price;
                  updates[`table_po.${targetRow}.quantity`] =
                    item.quantity;
                  if (isManualChildRow && bundleParentQty > 0) {
                    updates[`table_po.${targetRow}.bundle_ratio`] =
                      (Number(item.quantity) || 0) / bundleParentQty;
                  }
                  updates[`table_po.${targetRow}.min_qty`] =
                    item.min_qty;
                  updates[`table_po.${targetRow}.max_qty`] =
                    item.max_qty;
                  updates[`table_po.${targetRow}.discount`] =
                    item.discount;
                  updates[`table_po.${targetRow}.discount_uom`] =
                    item.discount_uom;
                }

                await this.setData(updates);
                await this.triggerEvent("POcalculation");
                done();
              } else if (action === "cancel") {
                for (const item of result.data.data) {
                  updates[`table_po.${targetRow}.max_price`] =
                    item.max_price;
                  updates[`table_po.${targetRow}.min_price`] =
                    item.min_price;
                  updates[`table_po.${targetRow}.min_qty`] = item.min_qty;
                  updates[`table_po.${targetRow}.max_qty`] = item.max_qty;
                }

                await this.setData(updates);
                done();
              } else {
                done();
              }
            },
          },
        );
      },
      (error) => {
        console.log("error", error);
      },
    );
  }
})();
