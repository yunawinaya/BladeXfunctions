const roundQty = (value) => {
  return value;
};

// Over-receive tolerance by UOM (first row per UOM, like find()); 0 = none.
const toleranceEntry = (uomRows) => {
  const entry = {};
  const seen = new Set();
  (uomRows || []).forEach((conv) => {
    if (seen.has(conv.alt_uom_id)) return;
    seen.add(conv.alt_uom_id);
    if (conv.over_receive_tolerance) {
      entry[conv.alt_uom_id] = conv.over_receive_tolerance;
    }
  });
  return Object.keys(entry).length > 0 ? entry : 0;
};

// Item map cached in _data by func_processGRLineItem, else one projected read.
const getOverReceiveTolerance = async (itemId, uomId) => {
  const key = String(itemId);
  let entry = ((this.models["_data"] || {}).gr_item_tol || {})[key];

  if (entry === undefined) {
    const { data } = await db
      .collection("Item")
      .field("table_uom_conversion")
      .where({ id: itemId })
      .get();
    if (!data || data.length === 0) return 0;

    entry = toleranceEntry(data[0].table_uom_conversion);
    const store = this.models["_data"] || {};
    this.models["_data"] = {
      ...store,
      gr_item_tol: { ...(store.gr_item_tol || {}), [key]: entry },
    };
  }

  return (entry && entry[uomId]) || 0;
};

// The validated row itself rather than a copy of the whole form per cell.
const fieldParts = rule.field.split(".");
const index = fieldParts[1];
const row = this.getValue(`table_gr.${index}`);

const materialId = row.item_id;
const orderedQtyUom = row.ordered_qty_uom;
const initialReceivedQty = parseFloat(row.initial_received_qty) || 0;
const orderQty = parseFloat(row.ordered_qty) || 0;
const baseOrderedQty = parseFloat(row.base_ordered_qty) || 0;
const uomConversion = parseFloat(row.uom_conversion) || 0;
const isSplit = row.is_split;
const parentOrChild = row.parent_or_child;

if (!window.validationState) {
  window.validationState = {};
}

const parsedValue = parseFloat(value);

(async () => {
  console.log("materialid", materialId);

  // Skip validation for hierarchy split parent rows (quantities managed by split logic)
  if (isSplit === "Yes" && parentOrChild === "Parent") {
    console.log("Hierarchy split parent row - skipping validation");
    window.validationState[index] = true;
    callback();
    return;
  }

  // Skip validation for child rows (quantities managed by split dialog)
  if (parentOrChild === "Child") {
    console.log("Child row - skipping validation");
    window.validationState[index] = true;
    callback();
    return;
  }

  // Note: Split-Parent rows fall through to normal validation
  // They are independent and validated like regular rows

  // Get GR status - skip validation for Created GRs (allow over-commitment)
  const grStatus = this.getValue("gr_status");

  // For Created GRs, don't block - just show visual feedback via to_received_qty
  if (grStatus === "Created") {
    console.log(
      "Created status - skipping validation, allowing over-commitment",
    );
    window.validationState[index] = true;
    callback();
    return;
  }

  // For Draft/Received GRs, validate and cap (only for non-split parent rows)
  if (materialId) {
    const overReceiveTolerance = await getOverReceiveTolerance(
      materialId,
      orderedQtyUom,
    );

    if (uomConversion > 0) {
      // UOM conversion path - validate at base level
      const baseInitialReceivedQty = roundQty(
        initialReceivedQty * uomConversion,
      );
      const maxAllowedBaseQty = roundQty(
        (baseOrderedQty * (100 + overReceiveTolerance)) / 100,
      );
      const baseReceivedQty = roundQty(parsedValue * uomConversion);

      if (
        roundQty(baseReceivedQty + baseInitialReceivedQty) > maxAllowedBaseQty
      ) {
        const maxAllowedQty = roundQty(
          (maxAllowedBaseQty - baseInitialReceivedQty) / uomConversion,
        );

        // Cap the quantity to max allowed
        await this.setData({
          [`table_gr.${index}.received_qty`]: maxAllowedQty,
          [`table_gr.${index}.base_received_qty`]: roundQty(
            maxAllowedBaseQty - baseInitialReceivedQty,
          ),
          [`table_gr.${index}.to_received_qty`]: 0,
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxAllowedQty} (${overReceiveTolerance}% over-receive tolerance).`,
        );
        window.validationState[index] = false;
        callback("Quantity is not enough to receive");
        return;
      }
    } else {
      // No UOM conversion path - validate against ordered qty (not remaining)
      const maxAllowedTotalQty = roundQty(
        (orderQty * (100 + overReceiveTolerance)) / 100,
      );

      if (roundQty(parsedValue + initialReceivedQty) > maxAllowedTotalQty) {
        const maxAllowedQty = roundQty(
          maxAllowedTotalQty - initialReceivedQty,
        );

        // Cap the quantity to max allowed
        await this.setData({
          [`table_gr.${index}.received_qty`]: maxAllowedQty,
          [`table_gr.${index}.base_received_qty`]: maxAllowedQty,
          [`table_gr.${index}.to_received_qty`]: 0,
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxAllowedQty} (${overReceiveTolerance}% over-receive tolerance).`,
        );
        window.validationState[index] = false;
        callback("Quantity is not enough to receive");
        return;
      }
    }
  }
  window.validationState[index] = true;
  callback();
})();
