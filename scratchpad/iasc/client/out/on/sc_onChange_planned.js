// Planned Output Qty changed: Small Cycle (scratchpad/iasc), handled by sc_main
this.triggerEvent("sc_main", { scOp: "PLANNED", value: arguments[0] && arguments[0].value });
