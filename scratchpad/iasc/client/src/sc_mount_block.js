// Small Cycle (scratchpad/iasc): after the v36 mounted work, the event sc_main (op MOUNT) shows the Small Cycle widgets for this
// page and status, reads the linked line's figures and, on a Sales Order line entry, prepares the components. Opening an
// Item Assembly never rebuilds its lines.
const SC_ENABLED = __SC_ENABLED__;
const SC_WF_PROJECTION = "__SO_IA_PROJECTION__"; // SO_IA_PROJECTION
const SC_WF_RELINK = "__IA_SC_RELINK__"; // IA_SC_RELINK
const scMount = (pageStatus, status) => {
  if (!(SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK))) return;
  this.triggerEvent("sc_main", { scOp: "MOUNT", pageStatus: pageStatus, status: status });
};
// -- end Small Cycle --
