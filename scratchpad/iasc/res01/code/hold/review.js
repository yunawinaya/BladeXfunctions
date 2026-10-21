// IA_HOLD - Review: an earlier run's stock move did not report back (intents without DONE), or the delta names why it cannot
// go on: no new move, the IA marked Needs review until that is resolved
const st = hdSqlRow([{{node:sql_node_HDstate.data}}][0]) || {};
const why = hdS(([{{node:code_node_HDdelta.data}}][0] || {}).why);
const message = why ? "Needs review: " + why + ", so nothing was changed. The reservation must be checked by an administrator."
  : "Needs review: an earlier reservation of this Item Assembly did not report back, so nothing was changed. Try again later; if it persists, "
  + "the reservation must be checked by an administrator.";
const res = { headRows: [{ id: hdS((st.ia || {}).id), material_hold_status: "REVIEW", material_hold_at: hdS(st.now) }], code: "200", message: message,
  result_json: JSON.stringify({ status: "REVIEW", lines: [], notHeld: [], short: [], held: 0, released: 0, checkedAt: hdS(st.now), message: message }) };
console.log("hold review", JSON.stringify({ message: message }));
return res;
