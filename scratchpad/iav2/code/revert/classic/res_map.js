// IA_REVERT v6 - RES-01 R5: the components to return (code_node_iaRvBuild's adds); for an IA that reserves, one issued from Reserved (its
// hold, closed at completion) comes back to the bucket its hold came from: this cycle's Delivered rows (after the IA's last revert,
// resRevertBound over its movements; review I3); loop_iaRvAdd reads these
const adds = [{{node:code_node_iaRvBuild.data.adds}}][0];
let st = null;
try {
  const raw = [{{node:sql_node_RESrvOwn.data}}][0];
  const r = (Array.isArray(raw) ? raw : raw ? [raw] : [])[0];
  st = r && r.j !== undefined ? (typeof r.j === "string" ? JSON.parse(r.j) : r.j) : null;
} catch (e) {
  st = null;
}
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const bound = resRevertBound(list([{{node:sql_node_iaRvMovs.data}}][0]), [{{node:code_node_iaRvPrep.data.iaId}}][0]);
const out = resRevertAdds(adds, [{{node:code_node_RESrvDue.data.hold}}][0], st && Array.isArray(st.delivered) ? st.delivered : [], bound,
  list([{{node:search_node_iaRvItems.data.data}}][0]));
return { adds: out };
