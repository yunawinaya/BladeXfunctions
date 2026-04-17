// Helper function to round quantity to 3 decimal places
const roundQty = (value) => {
  return Math.round(value * 1000) / 1000;
};

(async () => {
  try {
    // Get input values
    const quantity = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

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
    const tempHuDataStr = this.getValue(`table_gr.${rowIndex}.temp_hu_data`);

    if (tempHuDataStr && tempHuDataStr !== "[]") {
      const tempHuData = JSON.parse(tempHuDataStr);
      const totalStoreInQty = tempHuData.reduce(
        (sum, hu) => sum + (parseFloat(hu.store_in_quantity) || 0),
        0
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
            }
          );

          // User confirmed - clear temp_hu_data and view_hu
          await this.setData({
            [`table_gr.${rowIndex}.temp_hu_data`]: "[]",
            [`table_gr.${rowIndex}.view_hu`]: "",
          });
        } catch {
          // User cancelled - revert to HU total
          await this.setData({
            [`table_gr.${rowIndex}.received_qty`]: totalStoreInQty,
          });
          return;
        }
      }
    }

    // Skip calculation for hierarchy split parent rows (their quantities are managed by split logic)
    // Note: Split-Parent rows are treated like regular rows (no skip)
    const isSplit = this.getValue(`table_gr.${rowIndex}.is_split`);
    const parentOrChild = this.getValue(`table_gr.${rowIndex}.parent_or_child`);
    if (isSplit === "Yes" && parentOrChild === "Parent") {
      return;
    }

    // Split-Parent rows: treat like regular rows (fall through to regular logic)
    // They are independent and can have their own quantities validated normally

    // For child rows: validate total children qty against parent's ordered qty
    if (parentOrChild === "Child") {
      const parentIndex = this.getValue(`table_gr.${rowIndex}.parent_index`);
      const tableGR = this.getValue("table_gr");

      // Find parent row to get ordered_qty
      const parentRow = tableGR.find(
        (row) =>
          row.is_split === "Yes" &&
          row.parent_or_child === "Parent" &&
          row.parent_index === parentIndex
      );

      if (parentRow) {
        const parentOrderedQty = parseFloat(parentRow.ordered_qty) || 0;
        const parentInitialReceivedQty =
          parseFloat(parentRow.initial_received_qty) || 0;
        const parentRemainingQty = parentOrderedQty - parentInitialReceivedQty;

        // Get all sibling children (excluding current row, we'll add the new value)
        const siblingChildren = tableGR.filter(
          (row, idx) =>
            row.parent_or_child === "Child" &&
            row.parent_index === parentIndex &&
            idx !== rowIndex
        );

        // Sum siblings' received_qty
        const siblingsTotal = siblingChildren.reduce(
          (sum, child) => sum + (parseFloat(child.received_qty) || 0),
          0
        );

        // Total with new value
        const totalChildrenQty = roundQty(siblingsTotal + quantity);

        // Get tolerance from item
        const itemId = this.getValue(`table_gr.${rowIndex}.item_id`);
        let overReceiveTolerance = 0;

        if (itemId) {
          const { data: itemData } = await db
            .collection("Item")
            .where({ id: itemId })
            .get();
          if (itemData && itemData.length > 0) {
            overReceiveTolerance = itemData[0].over_receive_tolerance || 0;
          }
        }

        // Calculate max allowed with tolerance
        const maxAllowedQty = roundQty(
          (parentRemainingQty * (100 + overReceiveTolerance)) / 100
        );

        // Validate
        if (totalChildrenQty > maxAllowedQty) {
          this.$message.warning(
            `Total split quantity (${totalChildrenQty}) exceeds maximum allowed (${maxAllowedQty}).`
          );
        }
      }

      // Update the child's quantities
      const uomConversion =
        this.getValue(`table_gr.${rowIndex}.uom_conversion`) || 0;
      const currentChildBaseQty =
        this.getValue(`table_gr.${rowIndex}.base_received_qty`) || 0;
      const baseReceivedQty =
        uomConversion > 0 ? roundQty(quantity * uomConversion) : quantity;

      const childUpdates = {
        [`table_gr.${rowIndex}.received_qty`]: quantity,
      };
      if (currentChildBaseQty !== baseReceivedQty) {
        childUpdates[`table_gr.${rowIndex}.base_received_qty`] = baseReceivedQty;
      }
      await this.setData(childUpdates);
      return;
    }

    // Get table values
    const orderedQty = this.getValue(`table_gr.${rowIndex}.ordered_qty`) || 0;
    const baseOrderedQty =
      this.getValue(`table_gr.${rowIndex}.base_ordered_qty`) || 0;
    const initialReceivedQty =
      this.getValue(`table_gr.${rowIndex}.initial_received_qty`) || 0;
    const uomConversion =
      this.getValue(`table_gr.${rowIndex}.uom_conversion`) || 0;
    const currentBaseQty =
      this.getValue(`table_gr.${rowIndex}.base_received_qty`) || 0;

    // Fetch over-receive tolerance from Item master
    const itemId = this.getValue(`table_gr.${rowIndex}.item_id`);
    let overReceiveTolerance = 0;

    if (itemId) {
      const { data: itemData } = await db
        .collection("Item")
        .where({ id: itemId })
        .get();
      if (itemData && itemData.length > 0) {
        overReceiveTolerance = itemData[0].over_receive_tolerance || 0;
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

    // Calculate remaining quantity to receive
    const toReceivedQty = orderedQty - initialReceivedQty;

    // Handle case when UOM conversion is 0 or not applicable
    if (quantity >= 0 && uomConversion === 0) {
      // Calculate max allowed with over-receive tolerance
      const maxAllowedQty = roundQty(
        (toReceivedQty * (100 + overReceiveTolerance)) / 100
      );

      if (quantity > maxAllowedQty) {
        console.warn(
          `Quantity (${quantity}) exceeds max allowed quantity (${maxAllowedQty}) with ${overReceiveTolerance}% tolerance`,
        );

        await this.setData({
          [`table_gr.${rowIndex}.received_qty`]: maxAllowedQty,
          [`table_gr.${rowIndex}.base_received_qty`]: maxAllowedQty,
          [`table_gr.${rowIndex}.to_received_qty`]: 0,
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxAllowedQty} (${overReceiveTolerance}% over-receive tolerance).`,
        );
        return;
      } else {
        const totalReceivedQty = roundQty(quantity + initialReceivedQty);
        const remainingQty = roundQty(orderedQty - totalReceivedQty);

        const updates = {
          [`table_gr.${rowIndex}.to_received_qty`]: remainingQty < 0 ? 0 : remainingQty,
        };
        if (currentBaseQty !== quantity) {
          updates[`table_gr.${rowIndex}.base_received_qty`] = quantity;
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
        (baseOrderedQty * (100 + overReceiveTolerance)) / 100
      );

      // Validate that we don't exceed max allowed base quantity (with tolerance)
      if (roundQty(baseReceivedQty + baseInitialReceivedQty) > maxAllowedBaseQty) {
        console.warn(
          `Base received quantity (${roundQty(
            baseReceivedQty + baseInitialReceivedQty,
          )}) exceeds max allowed base quantity (${maxAllowedBaseQty}) with ${overReceiveTolerance}% tolerance`,
        );

        const maxAllowedQty = roundQty(
          (maxAllowedBaseQty - baseInitialReceivedQty) / uomConversion,
        );

        await this.setData({
          [`table_gr.${rowIndex}.received_qty`]: maxAllowedQty,
          [`table_gr.${rowIndex}.base_received_qty`]: roundQty(
            maxAllowedBaseQty - baseInitialReceivedQty,
          ),
          [`table_gr.${rowIndex}.to_received_qty`]: 0,
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
        [`table_gr.${rowIndex}.to_received_qty`]: remainingQty < 0 ? 0 : remainingQty,
      };
      if (currentBaseQty !== baseReceivedQty) {
        updates[`table_gr.${rowIndex}.base_received_qty`] = baseReceivedQty;
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
        [`table_gr.${rowIndex}.received_qty`]: 0,
        [`table_gr.${rowIndex}.base_received_qty`]: 0,
        [`table_gr.${rowIndex}.to_received_qty`]: toReceivedQty,
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
