// The sibling query below takes these as text: digits only.
const digits = (v) => (/^[0-9]{1,20}$/.test(String(v == null ? "" : v)) ? String(v) : "");
const csv = (list) => [...new Set((list || []).map(digits).filter(Boolean))].join(",");
const _opd = {{node:get_node_jEllcWiJ.data.data}};
const picking = (Array.isArray(_opd) ? _opd[0] : _opd) || {};
return {
  orgId: digits(picking.organization_id) || "0",
  ownId: digits({{node:code_node_UDOp8D9x.data.id}}) || "0",
  gdIdCsv: csv({{node:code_node_oHIIKfiw.data.gdIds}}),
  lineIdCsv: csv({{node:code_node_oHIIKfiw.data.gdLineIds}}),
};
