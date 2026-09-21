(async () => {
  // Read the cap off the row the event carries rather than off rule.field.
  // A bundle's items validate at a nested path (table_si.0.children.1.…), and
  // splitting that path would take fieldParts[1] — the parent's index — so an
  // item would be checked against the bundle's available quantity instead of
  // its own.
  const availableInvQty = arguments[0].row.available_inv_qty;

  // The line shows what was delivered and what is still invoiceable, but not the
  // gap between them, so the reason is spelled out here. It is deliberately not
  // attributed to the return alone: the same gap is produced by a quantity that
  // was already invoiced on an earlier document.
  const delivered = parseFloat(arguments[0].row.good_delivery_quantity) || 0;
  const available = parseFloat(availableInvQty) || 0;
  const blocked = Math.round((delivered - available) * 1000000000) / 1000000000;
  const fmt = (n) =>
    String(Math.round((parseFloat(n) || 0) * 1000000000) / 1000000000);

  const positiveValue = Math.abs(value);
  if (positiveValue > availableInvQty) {
    let reason = `Invoice quantity cannot exceed ${fmt(available)}.`;

    if (blocked > 0) {
      reason += ` This line has ${fmt(delivered)} delivered; ${fmt(blocked)} is not invoiceable because it was returned or already invoiced.`;
    }

    callback(reason);
  } else {
    callback();
  }
})();
