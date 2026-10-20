// GD_ASYNC_SUBMIT - V2 fit (decision): a new save (CREATE) that GD_BULK_PREPARE would refuse where the classic save copes
// is answered GD_V2_USE_CLASSIC and no job is created; the caller saves it the classic way (the GD form: its frozen save).
@@GDV2_FIT@@
const fitDecide = function fitDecide(guard, route, linesJson, facts) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  let rows = [];
  try {
    rows = JSON.parse(s(linesJson) || "[]");
  } catch (e) {
    rows = [];
  }
  const why = s(route) === "CREATE" ? gdV2Fit(rows, facts) : "";
  return {
    route: why ? "CLASSIC" : "GO",
    result_code: why ? "GD_V2_USE_CLASSIC" : "",
    result_message: why ? "This delivery needs the classic save: " + why + "." : "",
    job_id: "",
    job_status: "",
    created: "NO",
    idempotency_key: s(guard.idempotencyKey),
    payload_hash: s(guard.payloadHash),
    gd_id: "",
    gd_no: "",
    progress_message: "",
    line_errors: "[]",
    evidence: JSON.stringify({ v: 1, workflow: "GD_ASYNC_SUBMIT", path: why ? "USE_CLASSIC" : "V2_FIT", reason: why, route: s(route) }),
  };
};
const res = fitDecide({ idempotencyKey: [{{node:code_node_EluyWNR5.data.idempotencyKey}}][0], payloadHash: [{{node:code_node_EluyWNR5.data.payloadHash}}][0] }, [{{node:code_node_iJTFTwP3.data.route}}][0], [{{node:code_node_GSfitPlan.data.linesJson}}][0], [{{node:sql_node_GSfit.data}}][0]);
console.log("submit V2 fit decision", JSON.stringify({ route: res.route, reason: res.result_message }));
return res;
