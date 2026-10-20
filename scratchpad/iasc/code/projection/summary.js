// SO_IA_PROJECTION - SUMMARY: one SO line's sales and production figures (CONTRACT.md section 6)
const g = [{{node:code_node_SPguard.data}}][0] || {};
const lh = spRows([{{node:sql_node_SPline.data}}][0])[0] || {};
// the line is read by id within the tenant: another organisation's Sales Order shows no figures
if (lh.header && spS(lh.header.organization_id) !== spS(g.org)) {
  console.log("projection summary refused: another organisation", JSON.stringify({ org: g.org }));
  return { code: "400", message: "This Sales Order line belongs to another organization.", result_json: "" };
}
const res = scProject({ line: lh.line || null, header: lh.header || null, fg: spRows([{{node:sql_node_SPfg.data}}][0])[0] || null,
  ias: spRows([{{node:sql_node_SPias.data}}][0]), excludeIaId: g.exclude, iaItemId: g.item, iaOrgId: g.org, proposal: g.proposal, baseline: g.baseline,
  candidates: spRows([{{node:sql_node_SPrelink.data}}][0]) });
res.orphans = spRows([{{node:sql_node_SPorphans.data}}][0]);
res.line = lh.line || null;
res.header = lh.header || null;
console.log("projection summary", JSON.stringify({ totals: res.totals, warnings: res.warnings.map((w) => w.code) }));
return { code: "200", message: "", result_json: JSON.stringify(res) };
