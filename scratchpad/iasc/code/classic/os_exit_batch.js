// IA_SAVE v14 - C2: the split's batches are not all there: the claim records PARTIAL|RECEIPT|0/<n> (nothing of the output received)
const win = [{{node:code_node_IAclaimWin.data}}][0] || {};
const ref = "PARTIAL|RECEIPT|" + {{node:code_node_OSreceipts.data.marker}};
return { rows: (Array.isArray(win.exitRows) ? win.exitRows : []).map((r) => Object.assign({}, r, { result_ref: ref })) };
