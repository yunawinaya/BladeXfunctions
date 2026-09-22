// BOM component quantities are derived from item_qty, so a change has to re-scale
// them. The rescale flag tells the explosion to ask first when the components have
// been edited away from what it last produced.

const itemId = this.getValue("item_id");
if (itemId) {
  this.triggerEvent("onChange_assembledItem", { value: itemId, rescale: true });
}
