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

    // Calculate remaining quantity to receive
    const toReceivedQty = orderedQty - initialReceivedQty;

    // Handle case when UOM conversion is 0 or not applicable
    if (quantity >= 0 && uomConversion === 0) {
      if (quantity > toReceivedQty) {
        console.warn(
          `Quantity (${quantity}) exceeds remaining quantity (${toReceivedQty})`
        );

        await this.setData({
          [`table_gr.${rowIndex}.received_qty`]: quantity,
          [`table_gr.${rowIndex}.base_received_qty`]: quantity,
          [`table_gr.${rowIndex}.to_received_qty`]: 0,
        });

        // Show warning message
        this.$message.warning(
          `Received quantity exceeds remaining quantity. Remaining set to 0.`
        );
        return;
      } else {
        const totalReceivedQty = roundQty(quantity + initialReceivedQty);
        const remainingQty = roundQty(orderedQty - totalReceivedQty);

        await this.setData({
          [`table_gr.${rowIndex}.received_qty`]: quantity,
          [`table_gr.${rowIndex}.base_received_qty`]: quantity,
          [`table_gr.${rowIndex}.to_received_qty`]: remainingQty,
        });

        console.log(
          `Updated quantities - Received: ${quantity}, Remaining: ${remainingQty}`
        );
      }
    }

    // Handle case when UOM conversion is applicable
    if (uomConversion > 0 && quantity >= 0) {
      // Calculate base quantities using conversion (with rounding to avoid floating-point issues)
      const baseReceivedQty = roundQty(quantity * uomConversion);
      const baseInitialReceivedQty = roundQty(initialReceivedQty * uomConversion);

      // Validate that we don't exceed base ordered quantity
      if (roundQty(baseReceivedQty + baseInitialReceivedQty) > baseOrderedQty) {
        console.warn(
          `Base received quantity (${
            roundQty(baseReceivedQty + baseInitialReceivedQty)
          }) exceeds base ordered quantity (${baseOrderedQty})`
        );

        const maxAllowedQty = roundQty(
          (baseOrderedQty - baseInitialReceivedQty) / uomConversion
        );

        await this.setData({
          [`table_gr.${rowIndex}.received_qty`]: maxAllowedQty,
          [`table_gr.${rowIndex}.base_received_qty`]: roundQty(
            baseOrderedQty - baseInitialReceivedQty
          ),
          [`table_gr.${rowIndex}.to_received_qty`]: "0,000",
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxAllowedQty}`
        );
        return;
      }

      // Format remaining quantity
      const totalReceivedQty = roundQty(quantity + initialReceivedQty);
      const remainingQty = roundQty(orderedQty - totalReceivedQty);

      await this.setData({
        [`table_gr.${rowIndex}.received_qty`]: quantity,
        [`table_gr.${rowIndex}.base_received_qty`]: baseReceivedQty,
        [`table_gr.${rowIndex}.to_received_qty`]: remainingQty,
      });

      console.log("UOM conversion calculation:", {
        receivedQty: quantity,
        baseReceivedQty,
        toReceivedQty: remainingQty,
        conversionFactor: uomConversion,
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
      "An error occurred while calculating quantities. Please try again."
    );
  }
})();
