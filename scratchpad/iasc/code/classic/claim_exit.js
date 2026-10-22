// IA_SAVE - BA rev 1.2 C2: how this completion ends, written on its claim (the effect identity a person reconciles from): DONE at the end;
// PARTIAL|SUBTRACT / PARTIAL|RECEIPT when an issue or the receipt is refused after the header was written; a run that crashes leaves
// the claim HELD; a claim that lost to another completion is LOST (it did nothing). No claim taken: nothing to write
const win = [{{node:code_node_IAclaimWin.data}}][0] || {};
const rows = (list, ref) => (Array.isArray(list) ? list : []).map((r) => Object.assign({}, r, { result_ref: ref }));
return { done: rows(win.exitRows, "DONE"), sub: rows(win.exitRows, "PARTIAL|SUBTRACT"), add: rows(win.exitRows, "PARTIAL|RECEIPT"), lost: rows(win.freeRows, "LOST") };
