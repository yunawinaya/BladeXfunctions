// IA_REVERT v5 guard: more than 250 component rows (the classic completion's pick cap) -> 400, nothing written; a refused IA keeps its refusal
const CAP = 250;
const asArr = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);
const refused = Number({{node:code_node_iaRvPrep.data.refuse}}) === 1;
const picks = asArr({{node:code_node_iaRvPrep.data.liveOut}}).length;
const liveRows = picks + asArr({{node:code_node_iaRvPrep.data.liveIn}}).length;
const tooBig = !refused && picks > CAP ? 1 : 0;
return {
  tooBig,
  liveRows,
  message: tooBig ? "This Item Assembly has " + liveRows + " stock rows; this revert can process at most " + CAP + " at once. Revert it from the Item Assembly list if background revert is switched on, or contact support." : "",
};
