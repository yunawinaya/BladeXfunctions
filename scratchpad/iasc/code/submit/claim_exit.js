// IA_V2_SUBMIT - BA rev 1.2 C2: how this submit's claim ends: V2 once the IA is Processing (the background completion owns the effects
// from then on and writes Completed only after them); LOST when another completion held the IA (it did nothing)
const win = [{{node:code_node_ISclaimWin.data}}][0] || {};
const rows = (list, ref) => (Array.isArray(list) ? list : []).map((r) => Object.assign({}, r, { result_ref: ref }));
return { done: rows(win.exitRows, "V2"), lost: rows(win.freeRows, "LOST") };
