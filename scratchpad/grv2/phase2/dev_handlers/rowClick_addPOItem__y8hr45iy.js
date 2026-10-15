// Picking a PO line in the "Item" tab. An item bundle is one line on the order
// with the bundle's items beneath it, and it is received as a whole: picking
// the bundle takes its items along, so the GR ends up with the same shape the
// PO has.
//
// The row handed over by the list is usually the bundle line on its own, with
// nothing under it, so the bundle's items are read back here — first off the PO
// line record, then off the order. onConfirm_batchAddItem recurses over
// `children` when it builds the GR lines, and that is what fills it.
//
// The two sources are shaped differently and each is mapped on its own terms:
//
//   - the list row joins its references, so the item, UOM, tariff and bundle
//     arrive as objects (selectedPOItem.quantity_uom.alt_uom_id)
//   - a row read back off the order stores them as plain ids, and carries no
//     item record at all, so the item is fetched for it
//
// A bundle row is not an item, so the fields an item would fill (item, UOM,
// tariff, item code) can legitimately be empty on it — hence ?. throughout.

// Same fields the batch-add builder reads off the item, plus the name it
// displays. Mirrors fetchItemData in onConfirm_batchAddItem.
const fetchItemData = async (itemID) => {
  const resItem = await db
    .collection("Item")
    .field(
      "material_name,material_code,receiving_inspection,item_batch_management,batch_number_genaration,material_costing_method,item_category,serial_number_management,table_uom_conversion,based_uom,formula,table_default_bin",
    )
    .where({ id: itemID })
    .get();

  if (!resItem || resItem.data.length === 0) return null;
  else return resItem.data[0];
};

// A reference is an object on a row off the list and a plain id on a row read
// back off the order.
const referenceId = (value) => {
  if (value && typeof value === "object") return value.id || null;
  return value || null;
};

// A UOM reference joins as { alt_uom_id } on a list row and is a plain id on a
// stored one.
const uomId = (value) => {
  if (value && typeof value === "object") return value.alt_uom_id || value.id || null;
  return value || null;
};

const asChildren = (value) =>
  Array.isArray(value) && value.length > 0 ? value : null;

// table_po is a tree — a bundle is ONE line with its items under `children`
// (that is how po_onConfirm_batchAddItemBundle builds it) — but which copy of
// the line carries that tree depends on where it is read from, so every place
// it can live is tried in turn. The line sub-record is first because it is the
// one pi_rowClick_addPOItem reads and is known to hold the tree.
//
// The last two are for orders whose bundle items were stored FLAT instead:
// siblings in table_po pointing back through parent_id, or — on older rows with
// no link at all — simply the rows following the bundle line.
const fetchBundleChildren = async (poId, bundleLine) => {
  // The row off the list may already carry them.
  const onSelection = asChildren(bundleLine?.children);
  if (onSelection) return onSelection;

  if (!bundleLine?.id) return [];

  const resPOLine = await db
    .collection("purchase_order_2ukyuanr_sub")
    .doc(bundleLine.id)
    .get();

  const onLineRecord = asChildren(resPOLine?.data?.[0]?.children);
  if (onLineRecord) return onLineRecord;

  if (!poId) {
    console.log("no purchase order on the bundle line", bundleLine.id);
    return [];
  }

  const resPO = await db.collection("purchase_order").doc(poId).get();
  const poLines = resPO?.data?.[0]?.table_po || [];

  const bundleIndex = poLines.findIndex(
    (line) => String(line.id) === String(bundleLine.id),
  );

  const onOrder =
    bundleIndex === -1 ? null : asChildren(poLines[bundleIndex]?.children);
  if (onOrder) return onOrder;

  const linked = poLines.filter(
    (line) =>
      line.parent_id !== undefined &&
      line.parent_id !== null &&
      String(line.parent_id) === String(bundleLine.id),
  );

  if (linked.length > 0) return linked;

  if (bundleIndex === -1) {
    console.log("bundle line not found on purchase order", poId, bundleLine.id);
    return [];
  }

  const bundleId = referenceId(bundleLine.item_bundle_id);
  const following = [];

  for (const line of poLines.slice(bundleIndex + 1)) {
    // A line of the same bundle carrying an item of its own is one of its
    // items; anything else closes the bundle.
    if (
      !referenceId(line.item_id) ||
      String(referenceId(line.item_bundle_id)) !== String(bundleId)
    ) {
      break;
    }

    following.push(line);
  }

  return following;
};

(async () => {
  const currentPOArray = this.getValue(`dialog_select_item.item_array`);
  const selectedPOItem = arguments[0].$eventArgs[0];
  const referenceType = this.getValue(`dialog_select_item.reference_type`);

  console.log("arguments[0].$eventArgs[0]", arguments[0].$eventArgs[0]);

  const index = currentPOArray.findIndex(
    (item) => item.purchase_order_line_id === selectedPOItem.id
  );

  if (index !== -1) {
    currentPOArray.splice(index, 1);
  } else {
    const mappedPOItem = {
      purchase_order_line_id: selectedPOItem.id,
      item: selectedPOItem.item_id,
      purchase_order: selectedPOItem.purchase_order_id,
      item_desc: selectedPOItem.item_desc,
      more_desc: selectedPOItem.more_desc,
      ordered_qty: selectedPOItem.quantity,
      item_uom: selectedPOItem.quantity_uom?.alt_uom_id || null,
      unit_price: selectedPOItem.unit_price,
      total_price: selectedPOItem.po_amount,
      line_remark_1: selectedPOItem.line_remark_1,
      line_remark_2: selectedPOItem.line_remark_2,
      received_qty: selectedPOItem.received_qty,
      alt_uom: selectedPOItem.alt_uom,
      tariff_id: selectedPOItem.tariff_id?.id || null,
      further_description: selectedPOItem.further_description,
      item_bundle_id: selectedPOItem.item_bundle_id?.id || null,
      item_bundle_code: selectedPOItem.item_bundle_id?.ib_no || "",
    };

    // Only a bundle line has items under it, and only it is worth reading the
    // order back for.
    if (mappedPOItem.item_bundle_id && !referenceId(selectedPOItem.item_id)) {
      const bundleChildren = await fetchBundleChildren(
        referenceId(selectedPOItem.purchase_order_id),
        selectedPOItem,
      );

      if (bundleChildren.length > 0) {
        // The same field set as the bundle line above. A child may arrive
        // joined or stored depending on which copy of the line carried the
        // tree, so every reference is normalised to an id. The item is fetched
        // because the builder reads its name, category, batch and costing
        // settings off it.
        mappedPOItem.children = await Promise.all(
          bundleChildren.map(async (child) => {
            const childItemId = referenceId(child.item_id);

            return {
              purchase_order_line_id: child.id,
              item: childItemId
                ? { ...(await fetchItemData(childItemId)), id: childItemId }
                : null,
              purchase_order: selectedPOItem.purchase_order_id,
              item_desc: child.item_desc,
              more_desc: child.more_desc,
              ordered_qty: child.quantity,
              item_uom: uomId(child.quantity_uom),
              unit_price: child.unit_price,
              total_price: child.po_amount,
              line_remark_1: child.line_remark_1,
              line_remark_2: child.line_remark_2,
              received_qty: child.received_qty,
              alt_uom: child.alt_uom,
              tariff_id: referenceId(child.tariff_id),
              further_description: child.further_description,
              item_bundle_id: referenceId(child.item_bundle_id),
              item_bundle_code: "",
            };
          }),
        );
      }

      console.log(
        "item bundle line",
        mappedPOItem.item_bundle_id,
        "picked up",
        bundleChildren.length,
        "items",
      );
    }

    currentPOArray.push(mappedPOItem);
  }

  console.log("currentPOArray", currentPOArray);

  const updatedPONumber = currentPOArray.map(
    (item) =>
      item.purchase_order.purchase_order_no +
      "\t" +
      // a bundle carries no item code, so it is listed by the bundle's
      (item.item_bundle_code || item.item?.material_code || item.item_desc || "")
  );

  console.log("updatedPONumber", updatedPONumber.join(", "));

  this.setData({
    ...(!referenceType || referenceType === ""
      ? { [`dialog_select_item.reference_type`]: "Item" }
      : {}),
    [`dialog_select_item.po_number_array`]: updatedPONumber.join(`\n`),
    [`dialog_select_item.item_array`]: currentPOArray,
  });
})();