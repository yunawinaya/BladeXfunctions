// Non-stock (stock_control 0) item ids learnt by one handler, kept for the others in this.models._data
const iaIsNonStock = (item) => !!item && (item.stock_control === 0 || item.stock_control === "0");
const iaNsItems = () => (this.models["_data"] || {}).ia_ns_items || {};
const iaNsRemember = (ids) => {
  if (!ids.length) return;
  const known = { ...iaNsItems() };
  ids.forEach((id) => {
    known[String(id)] = 1;
  });
  this.models["_data"] = { ...this.models["_data"], ia_ns_items: known };
};
// Transfer Stock off for the non-stock rows of [rowIndex, itemId] pairs, on again for the rest once any was switched off
const iaNsLinks = (pairs) => {
  const known = iaNsItems();
  const off = [];
  const on = [];
  pairs.forEach(([index, itemId]) => (known[String(itemId)] ? off : on).push(`stock_movement.${index}.transfer_stock`));
  if (!off.length && !(this.models["_data"] || {}).ia_ns_links) return;
  if (off.length) {
    this.models["_data"] = { ...this.models["_data"], ia_ns_links: 1 };
    this.disabled(off, true);
  }
  if (on.length) this.disabled(on, false);
};
