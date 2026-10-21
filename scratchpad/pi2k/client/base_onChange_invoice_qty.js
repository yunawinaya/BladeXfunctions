// An item bundle parent is not an item: it has no price of its own, and the
// quantity on it is a number of bundles. Invoicing N bundles invoices the same
// proportion of every item under it, so the parent's quantity is clamped to
// what is still invoiceable and then spread across the children by ratio —
// their own quantity fields are not editable.
//
// Invoice quantity may be negative — a credit against what was invoiced before.
// It is the size of the quantity that is capped; the sign is carried through to
// the items, so crediting half a bundle credits half of every item in it.
//
// Every other row falls straight through to the calculation, which is what the
// invoice_qty column used to call directly.

// Quantities pass through unchanged; the backend applies the formatting.
const roundQty = (value) => {
  return value;
};

(async () => {
  try {
    const quantity = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;

    if (rowIndex === undefined || rowIndex === null) {
      console.error("Row index is missing");
      return;
    }

    const tablePI = this.getValue("table_pi") || [];
    const currentRow = tablePI[rowIndex] || {};

    // The items are either nested under the parent row or sitting in table_pi
    // alongside it, pointing back through parent_id / parent_fm_key. Each shape
    // is written back differently, so which one we are in is remembered.
    const nestedChildren = Array.isArray(currentRow.children)
      ? currentRow.children
      : [];
    const flatChildren = [];

    if (nestedChildren.length === 0) {
      tablePI.forEach((row, index) => {
        if (index === rowIndex) return;

        const matchesId =
          row.parent_id != null &&
          currentRow.id != null &&
          String(row.parent_id) === String(currentRow.id);
        const matchesKey =
          row.parent_fm_key != null &&
          currentRow.fm_key != null &&
          String(row.parent_fm_key) === String(currentRow.fm_key);

        if (matchesId || matchesKey) {
          flatChildren.push({ row, index });
        }
      });
    }

    const isBundleParent =
      currentRow.item_bundle_id &&
      !currentRow.material_id &&
      (nestedChildren.length > 0 || flatChildren.length > 0);

    if (isBundleParent) {
      // A bundle carries no tolerance of its own, so the most that can be
      // invoiced is whatever is still outstanding on the bundle line — in
      // either direction, which is why it is the size of the quantity that is
      // measured against it rather than the quantity itself.
      const parentAvailableQty = Math.abs(
        parseFloat(currentRow.available_inv_qty) || 0,
      );
      const numericQuantity = parseFloat(quantity) || 0;
      const sign = numericQuantity < 0 ? -1 : 1;

      let invoicedBundles = roundQty(Math.abs(numericQuantity));

      if (invoicedBundles > parentAvailableQty) {
        invoicedBundles = parentAvailableQty;

        this.$message.warning(
          `Invoice quantity adjusted to maximum allowed: ${roundQty(
            sign * parentAvailableQty,
          )}.`,
        );
      }

      const effectiveQty = roundQty(sign * invoicedBundles);

      // Invoicing half a bundle invoices half of every item in it, and
      // crediting half a bundle credits half of every item in it — same ratio,
      // same sign as the bundle line.
      const ratio =
        parentAvailableQty > 0 ? invoicedBundles / parentAvailableQty : 0;

      const childQuantity = (child) =>
        roundQty(
          sign * Math.abs(parseFloat(child.available_inv_qty) || 0) * ratio,
        );

      const updates = {
        [`table_pi.${rowIndex}.invoice_qty`]: effectiveQty,
      };

      if (nestedChildren.length > 0) {
        // Written as one array rather than field by field: a nested child path
        // (table_pi.N.children.M.invoice_qty) is not reliably addressable.
        updates[`table_pi.${rowIndex}.children`] = nestedChildren.map(
          (child) => ({ ...child, invoice_qty: childQuantity(child) }),
        );
      } else {
        for (const { row, index } of flatChildren) {
          updates[`table_pi.${index}.invoice_qty`] = childQuantity(row);
        }
      }

      await this.setData(updates);

      console.log("item bundle line", currentRow.item_bundle_id, {
        invoiced: effectiveQty,
        available: parentAvailableQty,
        ratio,
        sign,
        shape: nestedChildren.length > 0 ? "nested" : "flat",
        children: (nestedChildren.length > 0
          ? nestedChildren
          : flatChildren.map((child) => child.row)
        ).map((child) => childQuantity(child)),
      });
    }

    // The bundle rows have been squared up; price the document either way.
    await this.triggerEvent("PIcalculation");
  } catch (error) {
    console.error("Error in invoice quantity calculation:", error);

    if (error.stack) {
      console.error("Stack trace:", error.stack);
    }

    this.$message.error(
      "An error occurred while calculating quantities. Please try again.",
    );
  }
})();
