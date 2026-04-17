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

    // Handle negative quantity
    if (quantity < 0) {
      console.warn("Negative quantity entered");
      this.$message.error("Quantity cannot be negative");

      await this.setData({
        [`table_gr.${rowIndex}.received_qty`]: 0,
        [`table_gr.${rowIndex}.base_received_qty`]: 0,
        [`table_gr.${rowIndex}.to_received_qty`]: toReceivedQty,
      });
      return;
    }

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

        // Only set base_received_qty if it actually changed to avoid triggering base handler loop
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

      // Only set base_received_qty if it actually changed to avoid triggering base handler loop
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
