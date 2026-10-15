// some lines received + the rest untouched -> Partially Received (it used to end Cancelled)
//@@RULE@@
const rows = [{{node:sql_node_CcPoStatus.data}}][0] || [];
const headers = [];
for (const r of Array.isArray(rows) ? rows : [rows]) {
  const id = String(r.po_id || "");
  if (!/^[0-9]{1,20}$/.test(id)) continue;
  headers.push({ id, gr_status: poGrStatus(r) });
}
return { headers, hasHeaders: headers.length > 0 ? "YES" : "NO" };
