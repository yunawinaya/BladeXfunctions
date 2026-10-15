// Helper function to round quantity to 3 decimal places
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

(async () => {
  try {
    // Get input values
    const quantity = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    // rowIndex is not a usable position once table_gr is a tree -- a bundle's items
    // are not rows of it. Address the row by its own key, falling back to the index
    // only for a row the platform has not keyed.
    const eventRow = arguments[0].row;
    const rowPath =
      eventRow && eventRow.fm_key
        ? `table_gr.${eventRow.fm_key}`
        : `table_gr.${rowIndex}`;

    // Validate inputs
    if (rowIndex === undefined || rowIndex === null) {
      console.error("Row index is missing");
      return;
    }

    if (quantity === undefined || quantity === null) {
      console.error("Quantity value is missing");
      return;
    }

    // Check if line has HU data - if quantity changed, confirm reset
    const tempHuDataStr = this.getValue(`${rowPath}.temp_hu_data`);

    if (tempHuDataStr && tempHuDataStr !== "[]") {
      const tempHuData = JSON.parse(tempHuDataStr);
      const totalStoreInQty = tempHuData.reduce(
        (sum, hu) => sum + (parseFloat(hu.store_in_quantity) || 0),
        0,
      );

      // If new quantity differs from HU total, warn user
      if (quantity !== totalStoreInQty) {
        try {
          await this.$confirm(
            "Changing the received quantity will reset the selected Handling Units. Do you want to continue?",
            "Warning",
            {
              confirmButtonText: "Yes",
              cancelButtonText: "No",
              type: "warning",
            },
          );

          // User confirmed - clear temp_hu_data and view_hu
          await this.setData({
            [`${rowPath}.temp_hu_data`]: "[]",
            [`${rowPath}.view_hu`]: "",
          });
        } catch {
          // User cancelled - revert to HU total
          await this.setData({
            [`${rowPath}.received_qty`]: totalStoreInQty,
          });
          return;
        }
      }
    }

    // Skip calculation for hierarchy split parent rows (their quantities are managed by split logic)
    // Note: Split-Parent rows are treated like regular rows (no skip)
    const isSplit = this.getValue(`${rowPath}.is_split`);
    const parentOrChild = this.getValue(`${rowPath}.parent_or_child`);
    if (isSplit === "Yes" && parentOrChild === "Parent") {
      return;
    }

    // Split-Parent rows: treat like regular rows (fall through to regular logic)
    // They are independent and can have their own quantities validated normally

    // For child rows: validate total children qty against parent's ordered qty
    if (parentOrChild === "Child") {
      const parentIndex = this.getValue(`${rowPath}.parent_index`);
      const tableGR = this.getValue("table_gr");

      // Find parent row to get ordered_qty
      const parentRow = tableGR.find(
        (row) =>
          row.is_split === "Yes" &&
          row.parent_or_child === "Parent" &&
          row.parent_index === parentIndex,
      );

      // Effective qty for this child (received UOM) - capped if over tolerance
      let effectiveQty = quantity;

      if (parentRow) {
        const parentOrderedQty = parseFloat(parentRow.ordered_qty) || 0;
        const parentInitialReceivedQty =
          parseFloat(parentRow.initial_received_qty) || 0;

        // Get all sibling children (excluding current row, we'll add the new value)
        const siblingChildren = tableGR.filter(
          (row, idx) =>
            row.parent_or_child === "Child" &&
            row.parent_index === parentIndex &&
            idx !== rowIndex,
        );

        // Sum siblings' received_qty
        const siblingsTotal = siblingChildren.reduce(
          (sum, child) => sum + (parseFloat(child.received_qty) || 0),
          0,
        );

        // Total with new value
        const totalChildrenQty = roundQty(siblingsTotal + quantity);

        // Get tolerance from item
        const itemId = this.getValue(`${rowPath}.item_id`);
        let overReceiveTolerance = 0;

        if (itemId) {
          overReceiveTolerance = await getOverReceiveTolerance(
            itemId,
            this.getValue(`${rowPath}.ordered_qty_uom`),
          );
        }

        // Max allowed total (ordered qty based, not remaining)
        const maxAllowedTotalQty = roundQty(
          (parentOrderedQty * (100 + overReceiveTolerance)) / 100,
        );
        // Max this child may take (never below 0)
        const maxThisChild = roundQty(
          Math.max(
            0,
            maxAllowedTotalQty - parentInitialReceivedQty - siblingsTotal,
          ),
        );

        // Validate and hard-block: cap this child's qty when over tolerance
        if (totalChildrenQty + parentInitialReceivedQty > maxAllowedTotalQty) {
          effectiveQty = maxThisChild;
          this.$message.warning(
            `Received quantity adjusted to maximum allowed: ${maxThisChild} (${overReceiveTolerance}% over-receive tolerance).`,
          );
        }
      }

      // Update the child's quantities (using capped effectiveQty)
      const uomConversion =
        this.getValue(`${rowPath}.uom_conversion`) || 0;
      const currentChildBaseQty =
        this.getValue(`${rowPath}.base_received_qty`) || 0;
      const baseReceivedQty =
        uomConversion > 0
          ? roundQty(effectiveQty * uomConversion)
          : effectiveQty;

      const childUpdates = {
        [`${rowPath}.received_qty`]: effectiveQty,
      };
      if (currentChildBaseQty !== baseReceivedQty) {
        childUpdates[`${rowPath}.base_received_qty`] =
          baseReceivedQty;
      }
      await this.setData(childUpdates);
      return;
    }

    // An item bundle parent is not an item: no UOM conversion, no over-receive
    // tolerance, nothing to put away. Receiving N bundles means receiving the
    // same proportion of every item under it, so the parent's quantity is
    // clamped to what is still outstanding and then spread across the children
    // by ratio — their own quantity fields are not editable.
    const tableGRRows = this.getValue("table_gr") || [];
    const currentRow = eventRow || tableGRRows[rowIndex] || {};
    const bundleChildren = Array.isArray(currentRow.children)
      ? currentRow.children
      : [];

    if (
      currentRow.item_bundle_id &&
      !currentRow.item_id &&
      bundleChildren.length > 0
    ) {
      const parentOrderedQty = parseFloat(currentRow.ordered_qty) || 0;
      const parentInitialReceivedQty =
        parseFloat(currentRow.initial_received_qty) || 0;

      // Without this the ratio below is 0 and every item under the bundle is
      // silently reset to nothing, which reads as the quantity simply refusing
      // to take. Say why instead.
      if (parentOrderedQty <= 0) {
        this.$message.warning(
          "This bundle line has no ordered quantity, so there is nothing to spread across the items under it.",
        );
        return;
      }

      // A bundle carries no tolerance of its own, so the most that can be
      // received is whatever is still outstanding on the bundle line.
      const maxReceivableQty = roundQty(
        Math.max(0, parentOrderedQty - parentInitialReceivedQty),
      );

      let effectiveQty = roundQty(Math.max(0, quantity));

      if (effectiveQty > maxReceivableQty) {
        effectiveQty = maxReceivableQty;

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxReceivableQty}.`,
        );
      }

      // Receiving half a bundle receives half of every item in it.
      const ratio = parentOrderedQty > 0 ? effectiveQty / parentOrderedQty : 0;

      const updatedChildren = bundleChildren.map((child) => {
        const childOrderedQty = parseFloat(child.ordered_qty) || 0;
        const childInitialReceivedQty =
          parseFloat(child.initial_received_qty) || 0;
        const childUomConversion = parseFloat(child.uom_conversion) || 0;

        const childReceivedQty = roundQty(childOrderedQty * ratio);
        const childRemainingQty = roundQty(
          childOrderedQty - childInitialReceivedQty - childReceivedQty,
        );

        return {
          ...child,
          received_qty: childReceivedQty,
          base_received_qty:
            childUomConversion > 0
              ? roundQty(childReceivedQty * childUomConversion)
              : childReceivedQty,
          to_received_qty: childRemainingQty < 0 ? 0 : childRemainingQty,
        };
      });

      const parentRemainingQty = roundQty(
        parentOrderedQty - parentInitialReceivedQty - effectiveQty,
      );

      await this.setData({
        [`${rowPath}.received_qty`]: effectiveQty,
        [`${rowPath}.base_received_qty`]: effectiveQty,
        [`${rowPath}.to_received_qty`]:
          parentRemainingQty < 0 ? 0 : parentRemainingQty,
        // Written as one array rather than field by field: a nested child path
        // (table_gr.N.children.M.received_qty) is not reliably addressable.
        [`${rowPath}.children`]: updatedChildren,
      });

      console.log("item bundle line", currentRow.item_bundle_id, {
        received: effectiveQty,
        ordered: parentOrderedQty,
        ratio,
        children: updatedChildren.map((child) => child.received_qty),
      });

      return;
    }

    // Get table values
    const orderedQty = this.getValue(`${rowPath}.ordered_qty`) || 0;
    const baseOrderedQty =
      this.getValue(`${rowPath}.base_ordered_qty`) || 0;
    const initialReceivedQty =
      this.getValue(`${rowPath}.initial_received_qty`) || 0;
    const uomConversion =
      this.getValue(`${rowPath}.uom_conversion`) || 0;
    const currentBaseQty =
      this.getValue(`${rowPath}.base_received_qty`) || 0;

    // Fetch over-receive tolerance from Item master
    const itemId = this.getValue(`${rowPath}.item_id`);
    let overReceiveTolerance = 0;

    if (itemId) {
      overReceiveTolerance = await getOverReceiveTolerance(
        itemId,
        this.getValue(`${rowPath}.ordered_qty_uom`),
      );
    }

    console.log("Calculation inputs:", {
      quantity,
      rowIndex,
      orderedQty,
      baseOrderedQty,
      initialReceivedQty,
      uomConversion,
      overReceiveTolerance,
    });

    // Calculate remaining quantity to receive
    const toReceivedQty = orderedQty - initialReceivedQty;

    // Handle case when UOM conversion is 0 or not applicable
    if (quantity >= 0 && uomConversion === 0) {
      // Calculate max allowed against ordered qty (not remaining), with tolerance
      const maxAllowedTotalQty = roundQty(
        (orderedQty * (100 + overReceiveTolerance)) / 100,
      );

      if (roundQty(quantity + initialReceivedQty) > maxAllowedTotalQty) {
        const maxAllowedQty = roundQty(maxAllowedTotalQty - initialReceivedQty);

        console.warn(
          `Quantity (${quantity}) exceeds max allowed quantity (${maxAllowedQty}) with ${overReceiveTolerance}% tolerance`,
        );

        await this.setData({
          [`${rowPath}.received_qty`]: maxAllowedQty,
          [`${rowPath}.base_received_qty`]: maxAllowedQty,
          [`${rowPath}.to_received_qty`]: 0,
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxAllowedQty} (${overReceiveTolerance}% over-receive tolerance).`,
        );
        return;
      } else {
        const totalReceivedQty = roundQty(quantity + initialReceivedQty);
        const remainingQty = roundQty(orderedQty - totalReceivedQty);

        const updates = {
          [`${rowPath}.to_received_qty`]:
            remainingQty < 0 ? 0 : remainingQty,
        };
        if (currentBaseQty !== quantity) {
          updates[`${rowPath}.base_received_qty`] = quantity;
        }
        await this.setData(updates);

        console.log(
          `Updated quantities - Received: ${quantity}, Remaining: ${remainingQty < 0 ? 0 : remainingQty}`,
        );
      }
    }

    // Handle case when UOM conversion is applicable
    if (uomConversion > 0 && quantity >= 0) {
      // Calculate base quantities using conversion (with rounding to avoid floating-point issues)
      const baseReceivedQty = roundQty(quantity * uomConversion);
      const baseInitialReceivedQty = roundQty(
        initialReceivedQty * uomConversion,
      );

      // Calculate max allowed base qty with over-receive tolerance
      const maxAllowedBaseQty = roundQty(
        (baseOrderedQty * (100 + overReceiveTolerance)) / 100,
      );

      // Validate that we don't exceed max allowed base quantity (with tolerance)
      if (
        roundQty(baseReceivedQty + baseInitialReceivedQty) > maxAllowedBaseQty
      ) {
        console.warn(
          `Base received quantity (${roundQty(
            baseReceivedQty + baseInitialReceivedQty,
          )}) exceeds max allowed base quantity (${maxAllowedBaseQty}) with ${overReceiveTolerance}% tolerance`,
        );

        const maxAllowedQty = roundQty(
          (maxAllowedBaseQty - baseInitialReceivedQty) / uomConversion,
        );

        await this.setData({
          [`${rowPath}.received_qty`]: maxAllowedQty,
          [`${rowPath}.base_received_qty`]: roundQty(
            maxAllowedBaseQty - baseInitialReceivedQty,
          ),
          [`${rowPath}.to_received_qty`]: 0,
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxAllowedQty} (${overReceiveTolerance}% over-receive tolerance).`,
        );
        return;
      }

      // Format remaining quantity
      const totalReceivedQty = roundQty(quantity + initialReceivedQty);
      const remainingQty = roundQty(orderedQty - totalReceivedQty);

      const updates = {
        [`${rowPath}.to_received_qty`]:
          remainingQty < 0 ? 0 : remainingQty,
      };
      if (currentBaseQty !== baseReceivedQty) {
        updates[`${rowPath}.base_received_qty`] = baseReceivedQty;
      }
      await this.setData(updates);

      console.log("UOM conversion calculation:", {
        receivedQty: quantity,
        baseReceivedQty,
        toReceivedQty: remainingQty < 0 ? 0 : remainingQty,
        conversionFactor: uomConversion,
        overReceiveTolerance,
      });
    }

    // Handle negative quantity
    if (quantity < 0) {
      console.warn("Negative quantity entered");
      this.$message.error("Quantity cannot be negative");

      await this.setData({
        [`${rowPath}.received_qty`]: 0,
        [`${rowPath}.base_received_qty`]: 0,
        [`${rowPath}.to_received_qty`]: toReceivedQty,
      });
    }
  } catch (error) {
    console.error("Error in quantity calculation:", error);

    // Log additional error details
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    this.$message.error(
      "An error occurred while calculating quantities. Please try again.",
    );
  }
})();
