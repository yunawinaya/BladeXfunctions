// IA_TRANSFER_REQUEST - Guard: the operation, digit ids, the session tenant and user, what each operation needs (spec IA-LT-09: the
// user, tenant and organisation come from the session and the reads, never from the client alone); DEFECT's defects (iatrDefectsOf)
const trGuard = function trGuard(input) {
  const inp = input || {};
  const s = iatrS;
  const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
  const op = s(inp.operation).toUpperCase();
  const bad = (why) => ({ route: "REJECT", code: "400", message: why, tenantId: "0", uid: "0", op: op, ia: "0", org: "0", lot: "0", sl: "0", bin: "0", requiredDate: "",
    expectFp: "", key: "", needLines: "NO", needNamed: "NO", needDest: "NO", needDefect: "NO", defects: {}, result_json: "{}" });
  if (!digits(inp.tenantId)) return bad("no session tenant");
  if (!digits(inp.uid)) return bad("no session user");
  if (IATR_OPS2.indexOf(op) < 0) return bad("operation must be CREATE, REFRESH, REPLACE, DEFECT, CANCEL or STATUS");
  const named = op === "REFRESH" || op === "CANCEL";
  const dest = op === "CREATE" || op === "REPLACE";
  const wrong = ["ia_id", "organization_id"].concat(named ? ["lot_id"] : [], dest ? ["storage_location_id", "location_id"] : []).filter((k) => !digits(inp[k]))[0];
  if (wrong) return bad(wrong + ": digits only");
  if ((dest || op === "REFRESH") && !/^IA1:[0-9]+:[0-9a-f]{16}$/.test(s(inp.expected_fp))) return bad("expected_fp: the Item Assembly as the form shows it (IA1)");
  if (op !== "STATUS" && !/^[A-Za-z0-9|:_.-]{8,128}$/.test(s(inp.idempotency_key))) return bad("idempotency_key: 8 to 128 characters of A-Z a-z 0-9 | : _ . -");
  const df = op === "DEFECT" ? iatrDefectsOf(inp.defects) : { ok: true, defects: {} };
  if (!df.ok) return bad(df.message);
  return { route: "GO", code: "200", message: "", tenantId: s(inp.tenantId), uid: s(inp.uid), op: op, ia: s(inp.ia_id), org: s(inp.organization_id),
    lot: named ? s(inp.lot_id) : "0", sl: dest ? s(inp.storage_location_id) : "0", bin: dest ? s(inp.location_id) : "0", requiredDate: dest ? s(inp.required_date) : "",
    expectFp: s(inp.expected_fp), key: s(inp.idempotency_key), needLines: op === "CANCEL" ? "NO" : "YES", needNamed: named ? "YES" : "NO", needDest: dest ? "YES" : "NO",
    needDefect: op === "DEFECT" ? "YES" : "NO", defects: df.defects, result_json: "{}" };
};
const res = trGuard({ operation: [{{workflowparams:operation}}][0], ia_id: [{{workflowparams:ia_id}}][0], organization_id: [{{workflowparams:organization_id}}][0],
  lot_id: [{{workflowparams:lot_id}}][0], expected_fp: [{{workflowparams:expected_fp}}][0], storage_location_id: [{{workflowparams:storage_location_id}}][0],
  location_id: [{{workflowparams:location_id}}][0], required_date: [{{workflowparams:required_date}}][0], idempotency_key: [{{workflowparams:idempotency_key}}][0],
  defects: [{{workflowparams:defects}}][0], tenantId: [{{system:tenantId}}][0], uid: [{{system:uid}}][0] });
console.log("request guard", JSON.stringify({ route: res.route, op: res.op, ia: res.ia, lot: res.lot, message: res.message }));
return res;
