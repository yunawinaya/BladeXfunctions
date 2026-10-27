// a split row's Group changed: IA output split (scratchpad/iasc), handled by os_main
this.triggerEvent("os_main", { osOp: "CELL", field: "os_group", rowIndex: arguments[0] && arguments[0].rowIndex, value: arguments[0] && arguments[0].value });
