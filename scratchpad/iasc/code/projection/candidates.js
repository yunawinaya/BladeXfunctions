// SO_IA_PROJECTION - CANDIDATES: the SO lines an IA of this item may link to, each with its suggestion
const g = [{{node:code_node_SPguard.data}}][0] || {};
const rows = spRows([{{node:sql_node_SPcand.data}}][0]);
const res = { candidates: scCandidates({ rows: rows, ias: spRows([{{node:sql_node_SPcandIas.data}}][0]), fg: spRows([{{node:sql_node_SPcfg.data}}][0])[0] || null,
  iaItemId: g.item, iaOrgId: g.org }), capped: rows.length >= 200 ? "YES" : "NO" };
console.log("projection candidates", JSON.stringify({ rows: rows.length, eligible: res.candidates.length }));
return { code: "200", message: "", result_json: JSON.stringify(res) };
