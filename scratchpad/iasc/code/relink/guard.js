// IA_SC_RELINK - Guard: digit ids, the session tenant and user
const rlGuard = function rlGuard(input) {
  const inp = input || {};
  const digits = (v) => /^[0-9]{1,20}$/.test(spS(v));
  const bad = (why) => ({ route: "REJECT", code: "400", tenantId: "0", ia: "0", line: "0", item: "0", org: "0", uid: "", result_message: why, result_json: "" });
  if (!digits(inp.tenantId)) return bad("no session tenant");
  const wrong = ["ia_id", "so_line_id", "item_id", "organization_id"].filter((k) => !digits(inp[k]))[0];
  if (wrong) return bad(wrong + ": digits only");
  return { route: "GO", code: "200", tenantId: spS(inp.tenantId), ia: spS(inp.ia_id), line: spS(inp.so_line_id), item: spS(inp.item_id), org: spS(inp.organization_id),
    uid: spS(inp.uid), result_message: "", result_json: "" };
};
const res = rlGuard({ ia_id: [{{workflowparams:ia_id}}][0], so_line_id: [{{workflowparams:so_line_id}}][0], item_id: [{{workflowparams:item_id}}][0],
  organization_id: [{{workflowparams:organization_id}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("relink guard", JSON.stringify({ route: res.route, message: res.result_message }));
return res;
