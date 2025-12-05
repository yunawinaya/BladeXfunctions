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
          [`table_gr.${rowIndex}.to_received_qty`]: "0,000",
        });

        // Show warning message
        this.$message.warning(
          `Received quantity exceeds remaining quantity. Remaining set to 0.`
        );
        return;
      } else {
        const totalReceivedQty = quantity + initialReceivedQty;
        const remainingQty = orderedQty - totalReceivedQty;
        const formattedRemainingQty = parseFloat(remainingQty.toFixed(3));
        await this.setData({
          [`table_gr.${rowIndex}.received_qty`]: quantity,
          [`table_gr.${rowIndex}.base_received_qty`]: quantity,
          [`table_gr.${rowIndex}.to_received_qty`]: formattedRemainingQty,
        });

        console.log(
          `Updated quantities - Received: ${quantity}, Remaining: ${formattedRemainingQty}`
        );
      }
    }

    // Handle case when UOM conversion is applicable
    if (uomConversion > 0 && quantity >= 0) {
      // Calculate base quantities using conversion
      const baseReceivedQty = quantity / uomConversion;
      const baseInitialReceivedQty = initialReceivedQty / uomConversion;

      // Validate that we don't exceed base ordered quantity
      if (baseReceivedQty + baseInitialReceivedQty > baseOrderedQty) {
        console.warn(
          `Base received quantity (${
            baseReceivedQty + baseInitialReceivedQty
          }) exceeds base ordered quantity (${baseOrderedQty})`
        );

        const maxAllowedQty =
          (baseOrderedQty - baseInitialReceivedQty) * uomConversion;
        const formattedMaxQty = parseFloat(maxAllowedQty.toFixed(3));

        await this.setData({
          [`table_gr.${rowIndex}.received_qty`]: formattedMaxQty,
          [`table_gr.${rowIndex}.base_received_qty`]:
            baseOrderedQty - baseInitialReceivedQty,
          [`table_gr.${rowIndex}.to_received_qty`]: "0,000",
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${formattedMaxQty}`
        );
        return;
      }

      // Format remaining quantity with comma as decimal separator
      const totalReceivedQty = quantity + initialReceivedQty;
      const remainingQty = orderedQty - totalReceivedQty;
      const formattedRemainingQty = parseFloat(remainingQty.toFixed(3));

      await this.setData({
        [`table_gr.${rowIndex}.received_qty`]: quantity,
        [`table_gr.${rowIndex}.base_received_qty`]: baseReceivedQty,
        [`table_gr.${rowIndex}.to_received_qty`]: formattedRemainingQty,
      });

      console.log("UOM conversion calculation:", {
        receivedQty: quantity,
        baseReceivedQty,
        toReceivedQty: formattedRemainingQty,
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
