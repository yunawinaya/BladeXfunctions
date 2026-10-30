// Split receipt switched: IA output split (scratchpad/iasc), handled by os_main
this.triggerEvent("os_main", { osOp: "SWITCH", value: arguments[0] && arguments[0].value });
