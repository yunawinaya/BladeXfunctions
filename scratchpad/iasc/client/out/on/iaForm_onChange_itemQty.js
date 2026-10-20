// Small Cycle (scratchpad/iasc): on an Item Assembly linked to a Sales Order line, in Flat mode, or holding a BOM snapshot, a new
// quantity recomputes the references from the saved snapshot (the event sc_main, op QTY), never the BOM re-scale below.
const SC_ENABLED = true;
const SC_WF_PROJECTION = "2112448183267332097"; // SO_IA_PROJECTION
const SC_WF_RELINK = "2112448260018900994"; // IA_SC_RELINK
if (SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK)) {
  const scText = (k) => {
    const v = this.getValue(k);
    return v === undefined || v === null ? "" : String(v).trim();
  };
  const scMode = scText("bom_consumption_mode");
  if (/^[0-9]{1,20}$/.test(scText("source_so_line_id")) || scMode === "FLAT" || (scMode === "STANDARD" && scText("bom_snapshot_json") !== "")) {
    this.triggerEvent("sc_main", { scOp: "QTY", value: arguments[0] && arguments[0].value });
    return;
  }
}
// -- end Small Cycle --
// BOM component quantities are derived from item_qty, so a change has to re-scale
// them. The rescale flag tells the explosion to ask first when the components have
// been edited away from what it last produced.

const itemId = this.getValue("item_id");
if (itemId) {
  this.triggerEvent("onChange_assembledItem", { value: itemId, rescale: true });
}
