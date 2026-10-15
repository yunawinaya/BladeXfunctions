// Helper function to round quantity to 3 decimal places
const roundQty = (value) => {
  return value;
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
    const uomConversionCheck =
      this.getValue(`${rowPath}.uom_conversion`) || 1;

    if (tempHuDataStr && tempHuDataStr !== "[]") {
      const tempHuData = JSON.parse(tempHuDataStr);
      const totalStoreInQty = tempHuData.reduce(
        (sum, hu) => sum + (parseFloat(hu.store_in_quantity) || 0),
        0,
      );

      // Convert totalStoreInQty to base UOM for comparison
      const totalStoreInBaseQty = totalStoreInQty * uomConversionCheck;

      // If new quantity differs from HU total (in base UOM), warn user
      if (quantity !== totalStoreInBaseQty) {
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
          // User cancelled - revert to HU total (in base UOM)
          await this.setData({
            [`${rowPath}.base_received_qty`]: totalStoreInBaseQty,
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
      const uomConversion =
        this.getValue(`${rowPath}.uom_conversion`) || 0;
      const receivedQty = roundQty(
        uomConversion > 0 ? quantity / uomConversion : quantity,
      );

      const parentIndex = this.getValue(`${rowPath}.parent_index`);
      const tableGR = this.getValue("table_gr");

      // Find parent row to get ordered_qty
      const parentRow = tableGR.find(
        (row) =>
          row.is_split === "Yes" &&
          row.parent_or_child === "Parent" &&
          row.parent_index === parentIndex,
      );

      // Effective received qty (received UOM) - capped if over tolerance
      let effectiveReceivedQty = receivedQty;

      if (parentRow) {
        const parentOrderedQty = parseFloat(parentRow.ordered_qty) || 0;
        const parentInitialReceivedQty =
          parseFloat(parentRow.initial_received_qty) || 0;

        // Get all sibling children (excluding current row)
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
        const totalChildrenQty = roundQty(siblingsTotal + receivedQty);

        // Get tolerance from item
        const itemId = this.getValue(`${rowPath}.item_id`);
        let overReceiveTolerance = 0;

        if (itemId) {
          const { data: itemData } = await db
            .collection("Item")
            .where({ id: itemId })
            .get();
          if (itemData && itemData.length > 0) {
            overReceiveTolerance = (((itemData[0].table_uom_conversion||[]).find(c=>c.alt_uom_id===this.getValue(`${rowPath}.ordered_qty_uom`))||{}).over_receive_tolerance||0);
          }
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
          effectiveReceivedQty = maxThisChild;
          this.$message.warning(
            `Received quantity adjusted to maximum allowed: ${maxThisChild} (${overReceiveTolerance}% over-receive tolerance).`,
          );
        }
      }

      const currentChildReceivedQty =
        this.getValue(`${rowPath}.received_qty`) || 0;
      const childUpdates = {};
      if (currentChildReceivedQty !== effectiveReceivedQty) {
        childUpdates[`${rowPath}.received_qty`] = effectiveReceivedQty;
      }
      // If capped, also reset the edited base field to reflect the cap
      if (effectiveReceivedQty !== receivedQty) {
        childUpdates[`${rowPath}.base_received_qty`] =
          uomConversion > 0
            ? roundQty(effectiveReceivedQty * uomConversion)
            : effectiveReceivedQty;
      }
      if (Object.keys(childUpdates).length > 0) {
        await this.setData(childUpdates);
      }
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
    const currentReceivedQty =
      this.getValue(`${rowPath}.received_qty`) || 0;

    // Fetch over-receive tolerance from Item master
    const itemId = this.getValue(`${rowPath}.item_id`);
    let overReceiveTolerance = 0;

    if (itemId) {
      const { data: itemData } = await db
        .collection("Item")
        .where({ id: itemId })
        .get();
      if (itemData && itemData.length > 0) {
        overReceiveTolerance = (((itemData[0].table_uom_conversion||[]).find(c=>c.alt_uom_id===this.getValue(`${rowPath}.ordered_qty_uom`))||{}).over_receive_tolerance||0);
      }
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

    // Handle negative quantity
    if (quantity < 0) {
      console.warn("Negative base quantity entered");
      this.$message.error("Quantity cannot be negative");

      const toReceivedQty = orderedQty - initialReceivedQty;
      await this.setData({
        [`${rowPath}.base_received_qty`]: 0,
        [`${rowPath}.received_qty`]: 0,
        [`${rowPath}.to_received_qty`]: toReceivedQty,
      });
      return;
    }

    // Calculate base initial received qty for validation
    const baseInitialReceivedQty =
      uomConversion > 0
        ? roundQty(initialReceivedQty * uomConversion)
        : initialReceivedQty;

    // Calculate max allowed base qty with over-receive tolerance
    const maxAllowedBaseQty = roundQty(
      (baseOrderedQty * (100 + overReceiveTolerance)) / 100,
    );

    // Validate and cap if exceeds max allowed
    let effectiveBaseQty = quantity;

    if (roundQty(quantity + baseInitialReceivedQty) > maxAllowedBaseQty) {
      effectiveBaseQty = roundQty(maxAllowedBaseQty - baseInitialReceivedQty);

      console.warn(
        `Base quantity (${quantity}) exceeds max allowed (${maxAllowedBaseQty - baseInitialReceivedQty}) with ${overReceiveTolerance}% tolerance`,
      );

      this.$message.warning(
        `Base received quantity adjusted to maximum allowed: ${effectiveBaseQty} (${overReceiveTolerance}% over-receive tolerance).`,
      );

      await this.setData({
        [`${rowPath}.base_received_qty`]: effectiveBaseQty,
      });
    }

    // Convert base to alt UOM
    const receivedQty = roundQty(
      uomConversion > 0 ? effectiveBaseQty / uomConversion : effectiveBaseQty,
    );

    // Calculate remaining qty in alt UOM
    const toReceivedQty = roundQty(
      orderedQty - receivedQty - initialReceivedQty,
    );

    const updates = {
      [`${rowPath}.to_received_qty`]:
        toReceivedQty < 0 ? 0 : toReceivedQty,
    };
    if (currentReceivedQty !== receivedQty) {
      updates[`${rowPath}.received_qty`] = receivedQty;
    }
    await this.setData(updates);
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
