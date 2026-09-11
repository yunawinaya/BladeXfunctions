// Component quantities are derived from item_qty, so a change has to re-scale
// them. Re-running the explosion keeps one copy of the formula.
const itemId = this.getValue("item_id");
if (itemId) {
  this.triggerEvent("onChange_assembledItem", { value: itemId });
}
