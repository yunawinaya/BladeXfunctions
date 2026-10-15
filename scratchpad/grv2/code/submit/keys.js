// GR_COMPLETE_SUBMIT - Keys: the ids the gate's reads need, from the FORM's lines (bigint columns reach the form as digit
// strings; the header's po_id JSON is not used: unquoted 19-digit numbers in it lose precision in JavaScript)
const submitKeys = function submitKeys(guard, entry, form) {
  const f = form && typeof form === "object" ? form : {};
  const rows = flatRows(f.table_gr);
  const items = {};
  const pos = {};
  for (const r of rows) {
    if (digits(r.item_id)) items[s(r.item_id)] = true;
    if (digits(r.line_po_id)) pos[s(r.line_po_id)] = true;
  }
  const org = guard.pageStatus === "Edit" && entry.organizationId ? entry.organizationId : s(f.organization_id);
  const plant = s(f.plant_id) || entry.plantId;
  const ok = rows.length > 0 && digits(org) && digits(plant) && digits(guard.tenantId);
  const why = ok ? "" : !rows.length ? "the form has no lines" : "the form has no valid organization or plant";
  // fail closed: only digits ever reach the SQL text below
  return {
    ok: ok ? "YES" : "NO", why: why, route: ok ? "GO" : "STOP", code: ok ? "" : "400", message: why,
    tenantId: digits(guard.tenantId) ? guard.tenantId : "0", itemIdsSql: ["0"].concat(Object.keys(items)).join(","), poIdsSql: ["0"].concat(Object.keys(pos)).join(","),
    organizationId: ok ? org : "0", plantId: ok ? plant : "0", lineCount: rows.length,
  };
};
const res = submitKeys([{{node:code_node_RSguard.data}}][0], [{{node:code_node_RSentry.data}}][0], [{{workflowparams:form}}][0]);
console.log("submit keys", JSON.stringify({ ok: res.ok, why: res.why, lines: res.lineCount, items: res.itemIdsSql.split(",").length - 1, pos: res.poIdsSql.split(",").length - 1 }));
return res;
