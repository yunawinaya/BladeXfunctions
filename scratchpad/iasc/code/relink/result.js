// IA_SC_RELINK - Result: the read-back must show the new line
const g = [{{node:code_node_RLguard.data}}][0] || {};
const back = spRows([{{node:sql_node_RLback.data}}][0])[0] || {};
const ok = spS(back.source_so_line_id) === spS(g.line);
console.log("relink result", JSON.stringify({ ok: ok }));
const out = ok ? { code: "200", message: "Re-linked to the Sales Order line.", result_json: JSON.stringify({ iaId: spS(back.id), lineId: spS(back.source_so_line_id) }) }
  : { code: "500", message: "The re-link could not be confirmed: open the Item Assembly again to check its Sales Order line.", result_json: "" };
return { code: out.code, message: out.message, result_json: out.result_json };
