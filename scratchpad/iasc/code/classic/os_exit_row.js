// IA_SAVE v14 - C2: output row k of n was refused: the claim records PARTIAL|RECEIPT|<k>/<n> (rows 1 to k-1 received)
const win = [{{node:code_node_IAclaimWin.data}}][0] || {};
const r = [{{node:code_node_OSaddPick.data}}][0] || {};
const add = [{{node:wf_OSadd.data}}][0] || {};
const k = Number(r.row) || 0;
const n = Number(r.n) || 0;
const ref = "PARTIAL|RECEIPT|" + k + "/" + n;
const why = add.errorMessage || add.message || "";
return { rows: (Array.isArray(win.exitRows) ? win.exitRows : []).map((x) => Object.assign({}, x, { result_ref: ref })),
  message: "Output row " + k + " of " + n + " could not be received" + (why ? ": " + why : "") + ". " + (k > 1 ? "Rows 1 to " + (k - 1) + " were received; " :
    "No output row was received; ") + "this Item Assembly needs review." };
