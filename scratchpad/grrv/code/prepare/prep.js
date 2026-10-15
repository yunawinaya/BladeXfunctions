// GR Revert Completed V2 - grRvParams + grRvPrep (lifted) on the receipt as GR_REVERT_COMPLETED reads it, shared by the
// PREPARE prep node and the SUBMIT gate. The classic's "more than 500 lines" refusal is its own guard, not V2's (V2 takes
// up to 2,500 lines): above 500 lines the receipt's refusal is found again on slices of at most 500 lines, each with the
// same header and movements - a header or movement refusal reads the same on every slice, the one line-based refusal that
// precedes a header one (a purchase return) is found on the slice holding the line, so it wins, else any slice's answer
const RV_OLD_PATH_LINES = 500;
const RV_MAX_LINES = 2500;
const RV_RETURN_REFUSAL = "A purchase return has already claimed quantity from this receipt.";
const RV_LINE_GUARD = /^This Goods Receiving has \d+ lines\. Reverting more than 500 lines is not supported yet\.$/;

// gr: the receipt (get-node row with its table_gr tree) or null; params: what the classic's request carried
const rvRunPrep = function rvRunPrep(gr, movRows, params) {
  const run = (g) => __withContext({
    "workflowparams:gr_id": params.grId, "workflowparams:gr_no": params.grNo, "workflowparams:organization_id": params.organizationId,
    "node:get_node_grRvGr": { data: rvGet(g) }, "node:sql_node_grRvMovs": { data: movRows },
  }, () => ({ params: __run("code_node_grRvParams"), prep: __run("code_node_grRvPrep") }));
  const full = run(gr);
  const out = full.prep;
  if (Number(out.refuse) !== 1 || !RV_LINE_GUARD.test(rvS(out.refuseMessage))) return { params: full.params, prep: out, slices: 0 };
  const found = [];
  let slices = 0;
  let chunk = [];
  let size = 0;
  const flush = () => {
    if (!chunk.length) return;
    const o = run(Object.assign({}, gr, { table_gr: chunk })).prep;
    slices++;
    if (Number(o.refuse) === 1) found.push(rvS(o.refuseMessage));
    chunk = [];
    size = 0;
  };
  for (const row of gr.table_gr || []) {
    const n = 1 + (Array.isArray(row.children) ? row.children.length : 0);
    // a single bundle row of more than 500 items cannot be sliced: the classic's refusal stands
    if (n > RV_OLD_PATH_LINES) return { params: full.params, prep: out, slices: -1 };
    if (size + n > RV_OLD_PATH_LINES) flush();
    chunk.push(row);
    size += n;
  }
  flush();
  out.refuse = found.length ? 1 : 0;
  out.refuseMessage = !found.length ? "" : found.indexOf(RV_RETURN_REFUSAL) >= 0 ? RV_RETURN_REFUSAL : found[0];
  return { params: full.params, prep: out, slices: slices };
};

// grRvPrep's id lists (orNone's "-1" when empty) -> comma-separated digits ("0" when empty); null when one is not an id
const rvIdsSql = (arr) => {
  const ids = rvList(arr).map(rvS).filter((v) => v !== "-1");
  if (ids.some((v) => !rvDigits(v))) return null;
  return ids.length ? ids.join(",") : "0";
};

const RV_PREP_SQL = ["sqlMinLiveId", "sqlPlantId", "sqlItemIds", "sqlBatchIds", "sqlHuIds", "sqlPoIds", "sqlPoLineIds"];

// GR_REVERT_PREPARE - Prep (code_node_VPprep): the receipt this job locked -> grRvPrep (lifted) on it as the classic saw it
// before the lock (gr_status = the job's previous status) -> its outputs (code_node_VPplan hands them to grRvBuild as
// grRvPrep's went to it) + the digit-only values the second round of reads interpolates (sql*; "0" unless route GO and not
// refused). FAIL: the job is not this run's (entry), the receipt is not Processing under it (GRV_NOT_LOCKED; unlockOk 0),
// what V2 does not take (GRV_NOT_ELIGIBLE: handling units, serial items; GRV_TOO_LARGE above 2,500 lines), an id that is
// not digits (GRV_INVALID_DATA). A grRvPrep refusal passes through (route GO, refuse 1: the plan answers it as GRV_400)
const rvPrep = function rvPrep(entry, S) {
  const e = entry || {};
  const req = e.request && typeof e.request === "object" ? e.request : {};
  const prev = rvS(req.previousStatus);
  const base = { route: "FAIL", code: "", message: "", unlockOk: 0, revertFrom: prev, lineCount: 0, refuse: 0, refuseMessage: "" };
  for (const k of RV_PREP_SQL) base[k] = "0";
  const fail = (code, message) => Object.assign(base, { route: "FAIL", code: code, message: message });
  if (rvS(e.route) !== "GO") return fail(rvS(e.result_code) || "GRV_INVALID_REQUEST", rvS(e.result_message) || "the job's request could not be read");
  if (!rvDigits(e.tenantId) || !rvDigits(e.grId) || !rvDigits(e.organizationId) || !rvDigits(e.jobId)) return fail("GRV_INVALID_DATA", "the job's tenant, receipt, organization or id is not an id");
  const A = rvAdapt1(S);
  const gr = A.hdr;
  if (!gr || !gr.id) return fail("GRV_INVALID_DATA", "Goods Receiving " + e.grId + " not found");
  const lock = A.lock || {};
  const mine = rvS(gr.gr_status) === "Processing" && rvS(lock.result_ref) !== "" && rvS(lock.result_ref) === rvS(e.idempotencyKey) && rvS(gr.gr_v2_job_id) === rvS(e.jobId);
  if (!mine) {
    return fail("GRV_NOT_LOCKED", "the Goods Receiving is " + (rvS(gr.gr_status) || "blank") + (rvS(gr.gr_v2_job_id) === rvS(e.jobId) ? "" : " under job " + (rvS(gr.gr_v2_job_id) || "none"))
      + (rvS(lock.result_ref) === rvS(e.idempotencyKey) ? "" : ", its lock is not this job's") + ": not Processing under this job");
  }
  // from here a failure puts the receipt back to its status before the submit (this job holds its lock; nothing was written)
  base.unlockOk = 1;
  if (prev !== "Completed" && prev !== "Received") return fail("GRV_INVALID_REQUEST", "the job's previous status is " + (prev || "missing"));
  // get_node_grRvGr reads the receipt of the request's organization, at the status the classic would have found
  const seen = rvS(gr.organization_id) === rvS(e.organizationId) ? Object.assign({}, gr, { gr_status: prev }) : null;
  const run = rvRunPrep(seen, A.movs, { grId: e.grId, grNo: rvS(gr.gr_no), organizationId: e.organizationId });
  const p = run.prep;
  base.lineCount = rvList(p.lines).length;
  if (Number(p.refuse) === 1) return Object.assign(base, { route: "GO", code: "400", message: rvS(p.refuseMessage), refuse: 1, refuseMessage: rvS(p.refuseMessage) });
  const n = base.lineCount;
  if (n > RV_MAX_LINES) return fail("GRV_TOO_LARGE", "This Goods Receiving has " + n + " lines. Reverting more than " + RV_MAX_LINES + " lines is not supported.");
  if (rvHasHu(p)) return fail("GRV_NOT_ELIGIBLE", "it has handling units: revert it with the classic revert");
  if (A.serialLines > 0) return fail("GRV_NOT_ELIGIBLE", "it has serial-numbered items: revert it with the classic revert");
  const sql = {
    sqlMinLiveId: rvDigits(p.minLiveIdSql) && rvS(p.minLiveIdSql) !== "0" ? rvS(p.minLiveIdSql) : null,
    sqlPlantId: rvDigits(p.plantId) ? rvS(p.plantId) : null,
    sqlItemIds: rvIdsSql(p.itemIds), sqlBatchIds: rvIdsSql(p.batchIds), sqlHuIds: rvIdsSql(p.huIds), sqlPoIds: rvIdsSql(p.poIds), sqlPoLineIds: rvIdsSql(p.poLineIds),
  };
  const bad = RV_PREP_SQL.filter((k) => sql[k] === null);
  if (bad.length) return fail("GRV_INVALID_DATA", "the receipt's " + bad.map((k) => k.slice(3)).join(", ") + " are not all ids");
  return Object.assign(base, p, sql, { route: "GO", code: "200", message: "prepared " + n + " lines, " + rvList(p.liveRows).length + " live receipt rows",
    unlockOk: 1, revertFrom: prev, lineCount: n, refuse: 0, refuseMessage: "" });
};
