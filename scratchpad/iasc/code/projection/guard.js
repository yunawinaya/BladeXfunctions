// SO_IA_PROJECTION - Guard: the operation, the session tenant, digit ids, the optional proposal and link baseline
const spGuard = function spGuard(input) {
  const inp = input || {};
  const digits = (v) => /^[0-9]{1,20}$/.test(spS(v));
  const op = spS(inp.operation);
  const bad = (why) => ({ route: "REJECT", code: "400", tenantId: "0", uid: "0", so: "0", line: "0", item: "0", exclude: "", org: "0", proposal: null, baseline: null,
    result_code: "SC_INVALID_DATA", result_message: why, result_json: "" });
  if (op !== "SUMMARY" && op !== "CANDIDATES") return bad("operation: SUMMARY or CANDIDATES");
  if (!digits(inp.tenantId)) return bad("no session tenant");
  // FIX-03: the organisation is checked against the session user, never taken on trust
  if (!digits(inp.uid)) return bad("no session user");
  if (!digits(inp.organization_id)) return bad("organization_id: digits only");
  if (!digits(inp.item_id)) return bad("item_id: digits only");
  if (op === "SUMMARY" && !digits(inp.so_line_id)) return bad("so_line_id: digits only");
  const opt = ["so_id", "exclude_ia_id", "proposal_uom_id"].filter((k) => spS(inp[k]) && !digits(inp[k]))[0];
  if (opt) return bad(opt + ": digits only");
  const pq = spS(inp.proposal_qty);
  if (pq && !/^[0-9]+(\.[0-9]+)?$/.test(pq)) return bad("proposal_qty: a quantity");
  const baseline = spParseJ(inp.baseline);
  return { route: op, tenantId: spS(inp.tenantId), uid: spS(inp.uid), so: spS(inp.so_id) || "0", line: op === "SUMMARY" ? spS(inp.so_line_id) : "0", item: spS(inp.item_id),
    exclude: spS(inp.exclude_ia_id), org: spS(inp.organization_id), proposal: pq ? { qty: pq, uomId: spS(inp.proposal_uom_id) } : null,
    baseline: baseline && typeof baseline === "object" && !Array.isArray(baseline) ? baseline : null, code: "200", result_code: "", result_message: "", result_json: "" };
};
const res = spGuard({ operation: [{{workflowparams:operation}}][0], so_id: [{{workflowparams:so_id}}][0], so_line_id: [{{workflowparams:so_line_id}}][0],
  item_id: [{{workflowparams:item_id}}][0], exclude_ia_id: [{{workflowparams:exclude_ia_id}}][0], organization_id: [{{workflowparams:organization_id}}][0],
  proposal_qty: [{{workflowparams:proposal_qty}}][0], proposal_uom_id: [{{workflowparams:proposal_uom_id}}][0], baseline: [{{workflowparams:baseline}}][0],
  tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("projection guard", JSON.stringify({ route: res.route, result: res.result_code, message: res.result_message }));
return res;
