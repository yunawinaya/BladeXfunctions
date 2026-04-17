const roundQty = (value) => {
  return Math.round(value * 1000) / 1000;
};

const { table_gr } = this.getValues();
const fieldParts = rule.field.split(".");
const index = fieldParts[1];

const materialId = table_gr[index].item_id;
const initialReceivedQty = parseFloat(table_gr[index].initial_received_qty) || 0;
const orderQty = parseFloat(table_gr[index].ordered_qty) || 0;
const baseOrderedQty = parseFloat(table_gr[index].base_ordered_qty) || 0;
const uomConversion = parseFloat(table_gr[index].uom_conversion) || 0;

const remainingQty = orderQty - initialReceivedQty;

if (!window.validationState) {
  window.validationState = {};
}

const parsedValue = parseFloat(value);

(async () => {
  console.log("materialid", materialId);

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

  // For Draft/Received GRs, validate and cap
  if (materialId) {
    const { data } = await db
      .collection("Item")
      .where({ id: materialId })
      .get();
    console.log("data", data);
    const overReceiveTolerance =
      data && data.length > 0 ? data[0].over_receive_tolerance || 0 : 0;

    if (uomConversion > 0) {
      // UOM conversion path - validate at base level
      const baseInitialReceivedQty = roundQty(initialReceivedQty * uomConversion);
      const maxAllowedBaseQty = roundQty(
        (baseOrderedQty * (100 + overReceiveTolerance)) / 100
      );
      const baseReceivedQty = roundQty(parsedValue * uomConversion);

      if (roundQty(baseReceivedQty + baseInitialReceivedQty) > maxAllowedBaseQty) {
        const maxAllowedQty = roundQty(
          (maxAllowedBaseQty - baseInitialReceivedQty) / uomConversion
        );

        // Cap the quantity to max allowed
        await this.setData({
          [`table_gr.${index}.received_qty`]: maxAllowedQty,
          [`table_gr.${index}.base_received_qty`]: roundQty(
            maxAllowedBaseQty - baseInitialReceivedQty
          ),
          [`table_gr.${index}.to_received_qty`]: 0,
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxAllowedQty} (${overReceiveTolerance}% over-receive tolerance).`
        );
        window.validationState[index] = false;
        callback("Quantity is not enough to receive");
        return;
      }
    } else {
      // No UOM conversion path
      const maxAllowedQty = roundQty(
        (remainingQty * (100 + overReceiveTolerance)) / 100
      );

      if (parsedValue > maxAllowedQty) {
        // Cap the quantity to max allowed
        await this.setData({
          [`table_gr.${index}.received_qty`]: maxAllowedQty,
          [`table_gr.${index}.base_received_qty`]: maxAllowedQty,
          [`table_gr.${index}.to_received_qty`]: 0,
        });

        this.$message.warning(
          `Received quantity adjusted to maximum allowed: ${maxAllowedQty} (${overReceiveTolerance}% over-receive tolerance).`
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
