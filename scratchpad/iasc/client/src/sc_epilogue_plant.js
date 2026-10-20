// Small Cycle (scratchpad/iasc): an Item Assembly holding a BOM snapshot gets its lines back from that snapshot at the new plant
// (the event sc_main, op PLANT; no BOM read): the v36 code above has just cleared them.
const SC_ENABLED = __SC_ENABLED__;
const SC_WF_PROJECTION = "__SO_IA_PROJECTION__"; // SO_IA_PROJECTION
const SC_WF_RELINK = "__IA_SC_RELINK__"; // IA_SC_RELINK
if (SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK) && arguments[0] && arguments[0].value) {
  const scText = (k) => {
    const v = this.getValue(k);
    return v === undefined || v === null ? "" : String(v).trim();
  };
  const scMode = scText("bom_consumption_mode");
  if ((scMode === "STANDARD" || scMode === "FLAT") && scText("bom_snapshot_json") !== "") {
    this.triggerEvent("sc_main", { scOp: "PLANT", value: arguments[0].value });
  }
}
// -- end Small Cycle --
