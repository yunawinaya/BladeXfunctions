// IA_HOLD - MIN-05 (BA 10-22): SWEEP's answer: the IAs deleted while still holding (id, organisation, number), for the list to release
// each with RELEASE_ALL; nothing read about them here, nothing moved
const hdSweep = function hdSweep(rows) {
  const st = hdSqlRow(rows) || {};
  const ias = (Array.isArray(st.ias) ? st.ias : []).filter((x) => x && /^[0-9]{1,20}$/.test(hdS(x.id)) && /^[0-9]{1,20}$/.test(hdS(x.org)))
    .map((x) => ({ id: hdS(x.id), org: hdS(x.org), no: hdS(x.no) }));
  return { code: "200", message: ias.length + " Item Assembl" + (ias.length === 1 ? "y was" : "ies were") + " deleted while still holding stock.",
    result_json: JSON.stringify({ ias: ias }) };
};
const res = hdSweep([{{node:sql_node_HDsweep.data}}][0]);
console.log("hold sweep", res.message);
return res;
