// Select on a line of the Select SO Line dialog: Small Cycle (scratchpad/iasc), handled by sc_main
this.triggerEvent("sc_main", { scOp: "PICK_LINE", rowIndex: arguments[0] && arguments[0].rowIndex, row: arguments[0] && arguments[0].row });
