// Small Cycle (scratchpad/iasc): an Item Assembly linked to a Sales Order line, in Flat mode, or holding a BOM snapshot is
// prepared by the event sc_main (op ITEM; op QTY for the item-quantity re-scale), never by the v36 code below.
const SC_ENABLED = __SC_ENABLED__;
const SC_WF_PROJECTION = "__SO_IA_PROJECTION__"; // SO_IA_PROJECTION
const SC_WF_RELINK = "__IA_SC_RELINK__"; // IA_SC_RELINK
const scArgs = arguments[0] || {};
if (SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK) && !scArgs.scLegacy) {
  const scText = (k) => {
    const v = this.getValue(k);
    return v === undefined || v === null ? "" : String(v).trim();
  };
  const scMode = scText("bom_consumption_mode");
  if (/^[0-9]{1,20}$/.test(scText("source_so_line_id")) || scMode === "FLAT" || (scMode === "STANDARD" && scText("bom_snapshot_json") !== "")) {
    this.triggerEvent("sc_main", { scOp: scArgs.rescale ? "QTY" : "ITEM", value: scArgs.value });
    return;
  }
}
// -- end Small Cycle --
