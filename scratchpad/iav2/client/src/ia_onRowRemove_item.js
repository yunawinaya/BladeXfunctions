// BOM Components onRowRemove: a disabled Transfer Stock stays with its row index, so the links are set again by item
setTimeout(() => {
  const state = this.models["_data"] || {};
  if (!state.ia_ns_links) return;
  const known = state.ia_ns_items || {};
  const off = [];
  const on = [];
  (this.getValue("stock_movement") || []).forEach((line, index) =>
    (known[String(line && line.item_selection)] ? off : on).push(`stock_movement.${index}.transfer_stock`),
  );
  if (off.length) this.disabled(off, true);
  if (on.length) this.disabled(on, false);
}, 50);
