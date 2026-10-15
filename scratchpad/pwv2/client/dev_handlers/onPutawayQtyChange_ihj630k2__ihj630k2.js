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

    const tablePutawayItem = this.getValue("table_putaway_item") || [];

    // rowIndex is not a reliable position once the table is a tree, so prefer the
    // row the event handed over and address it by its own key. Falling back to the
    // index keeps a plain, keyless row working exactly as before.
    const eventRow = arguments[0].row;
    const currentRow = eventRow || tablePutawayItem[rowIndex] || {};
    const rowPath =
      eventRow && eventRow.fm_key
        ? `table_putaway_item.${eventRow.fm_key}`
        : `table_putaway_item.${rowIndex}`;

    // An item bundle parent is not an item: it holds no stock, has no bin and
    // nothing of its own to store away. Putting away N of the bundle puts away
    // the same proportion of every item under it, so the parent's quantity is
    // clamped to what is still outstanding and then spread across its items by
    // ratio — their own quantity fields are not editable.
    const bundleChildren = Array.isArray(currentRow.children)
      ? currentRow.children
      : [];

    const isBundleParentRow =
      Boolean(currentRow.item_bundle_id) && !currentRow.item_code;

    if (!isBundleParentRow || bundleChildren.length === 0) {
      return;
    }

    const parentQtyToPutaway = parseFloat(currentRow.qty_to_putaway) || 0;
    const parentPendingQty = parseFloat(currentRow.pending_process_qty) || 0;

    // A bundle carries no tolerance of its own, so the most that can be put
    // away is whatever is still pending on the bundle line.
    let effectiveQty = Math.max(0, quantity);

    if (effectiveQty > parentPendingQty) {
      effectiveQty = parentPendingQty;

      this.$message.warning(
        `Putaway quantity adjusted to maximum allowed: ${parentPendingQty}.`,
      );
    }

    // Putting away half a bundle puts away half of every item in it.
    const ratio = parentQtyToPutaway > 0 ? effectiveQty / parentQtyToPutaway : 0;

    // The bundle row is authoritative: once its own pending reaches 0 the bundle is
    // fully put away by definition, so every item under it closes out completely.
    const isFinalPutaway = (parentPendingQty - effectiveQty) <= 0;

    const childPutawayQty = (child) => {
      const childQtyToPutaway = parseFloat(child.qty_to_putaway) || 0;
      const childPendingQty = parseFloat(child.pending_process_qty) || 0;

      // Spreading by ratio alone leaves rounding residue behind -- three single
      // bundles against a 1-unit item give 0.333 each and strand 0.001 -- and an
      // item's own quantity cell is not editable, so nobody could ever clear it.
      // The bundle would then sit at In Progress for good, and with it the source
      // GR's putaway_status. Closing out on the final putaway is what prevents it.
      if (isFinalPutaway) {
        return childPendingQty;
      }

      const putawayQty = childQtyToPutaway * ratio;

      // An item cannot store in more than it still has pending, whatever the
      // ratio works out to.
      return putawayQty > childPendingQty ? childPendingQty : putawayQty;
    };

    // Written as one array rather than field by field: a nested child path
    // (table_putaway_item.N.children.M.putaway_qty) is not reliably addressable.
    await this.setData({
      [`${rowPath}.putaway_qty`]: effectiveQty,
      [`${rowPath}.children`]: bundleChildren.map(
        (child) => ({
          ...child,
          putaway_qty: childPutawayQty(child),
        }),
      ),
    });

    console.log("item bundle line", currentRow.item_bundle_id, {
      putaway: effectiveQty,
      qtyToPutaway: parentQtyToPutaway,
      pending: parentPendingQty,
      ratio,
      children: bundleChildren.map((child) => ({
        item_code: child.item_code,
        putaway_qty: childPutawayQty(child),
      })),
    });
  } catch (error) {
    console.error("Error in putaway quantity calculation:", error);

    // Log additional error details
    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    this.$message.error(
      "An error occurred while calculating quantities. Please try again.",
    );
  }
})();
