// a place's Expand tick in the Flat dialog: Small Cycle (scratchpad/iasc), handled by sc_main
this.triggerEvent("sc_main", { scOp: "EXPAND_TICK", rowIndex: arguments[0] && arguments[0].rowIndex, value: arguments[0] && arguments[0].value });
