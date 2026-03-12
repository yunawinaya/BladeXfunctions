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

    console.log("Calculation inputs:", {
      quantity,
      rowIndex,
      orderedQty,
      baseOrderedQty,
      initialReceivedQty,
      uomConversion,
    });

    // quantity is base_received_qty, divide by uomConversion to get received_qty (alt UOM)
    // Apply rounding to avoid floating-point precision issues
    const receivedQty = roundQty(
      uomConversion > 0 ? quantity / uomConversion : quantity
    );

    // Calculate remaining qty in alt UOM (orderedQty, receivedQty, initialReceivedQty are all in alt UOM)
    const toReceivedQty = roundQty(orderedQty - receivedQty - initialReceivedQty);

    await this.setData({
      [`table_gr.${rowIndex}.received_qty`]: receivedQty,
      [`table_gr.${rowIndex}.to_received_qty`]: toReceivedQty,
    });
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
