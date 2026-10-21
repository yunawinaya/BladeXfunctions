// SO_IA_PROJECTION - CANDIDATES: the SO lines an IA of this item may link to, each with its suggestion
const g = [{{node:code_node_SPguard.data}}][0] || {};
// FIX-03: only a user assigned to the organisation (or one of its plants) sees its Sales Order lines
if (!(Number((spRows([{{node:sql_node_SPcmember.data}}][0])[0] || {}).member) > 0)) {
  console.log("projection candidates refused: the user is not assigned to the organisation", JSON.stringify({ org: g.org }));
  return { code: "400", message: "Your user is not assigned to this organisation, so its Sales Order lines cannot be listed.", result_json: "" };
}
const rows = spRows([{{node:sql_node_SPcand.data}}][0]);
const res = { candidates: scCandidates({ rows: rows, ias: spRows([{{node:sql_node_SPcandIas.data}}][0]), fg: spRows([{{node:sql_node_SPcfg.data}}][0])[0] || null,
  iaItemId: g.item, iaOrgId: g.org }), capped: rows.length >= 200 ? "YES" : "NO" };
console.log("projection candidates", JSON.stringify({ rows: rows.length, eligible: res.candidates.length }));
return { code: "200", message: "", result_json: JSON.stringify(res) };
