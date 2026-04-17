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

    // Get table values
    const orderedQty = this.getValue(`table_gr.${rowIndex}.ordered_qty`) || 0;
    const baseOrderedQty =
      this.getValue(`table_gr.${rowIndex}.base_ordered_qty`) || 0;
    const initialReceivedQty =
      this.getValue(`table_gr.${rowIndex}.initial_received_qty`) || 0;
    const uomConversion =
      this.getValue(`table_gr.${rowIndex}.uom_conversion`) || 0;
    const currentReceivedQty =
      this.getValue(`table_gr.${rowIndex}.received_qty`) || 0;

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

    // Handle negative quantity
    if (quantity < 0) {
      console.warn("Negative base quantity entered");
      this.$message.error("Quantity cannot be negative");

      const toReceivedQty = orderedQty - initialReceivedQty;
      await this.setData({
        [`table_gr.${rowIndex}.base_received_qty`]: 0,
        [`table_gr.${rowIndex}.received_qty`]: 0,
        [`table_gr.${rowIndex}.to_received_qty`]: toReceivedQty,
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
      (baseOrderedQty * (100 + overReceiveTolerance)) / 100
    );

    // Validate and cap if exceeds max allowed
    let effectiveBaseQty = quantity;

    if (roundQty(quantity + baseInitialReceivedQty) > maxAllowedBaseQty) {
      effectiveBaseQty = roundQty(maxAllowedBaseQty - baseInitialReceivedQty);

      console.warn(
        `Base quantity (${quantity}) exceeds max allowed (${maxAllowedBaseQty - baseInitialReceivedQty}) with ${overReceiveTolerance}% tolerance`
      );

      this.$message.warning(
        `Base received quantity adjusted to maximum allowed: ${effectiveBaseQty} (${overReceiveTolerance}% over-receive tolerance).`
      );

      await this.setData({
        [`table_gr.${rowIndex}.base_received_qty`]: effectiveBaseQty,
      });
    }

    // Convert base to alt UOM
    const receivedQty = roundQty(
      uomConversion > 0 ? effectiveBaseQty / uomConversion : effectiveBaseQty
    );

    // Calculate remaining qty in alt UOM
    const toReceivedQty = roundQty(
      orderedQty - receivedQty - initialReceivedQty
    );

    const updates = {
      [`table_gr.${rowIndex}.to_received_qty`]: toReceivedQty < 0 ? 0 : toReceivedQty,
    };

    // Only set received_qty if it actually changed to avoid triggering received handler loop
    if (currentReceivedQty !== receivedQty) {
      updates[`table_gr.${rowIndex}.received_qty`] = receivedQty;
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
