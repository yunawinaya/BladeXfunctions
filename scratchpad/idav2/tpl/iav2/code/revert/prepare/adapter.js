// Revert V2 - SQL rows -> the shapes IA_REVERT v4's reads gave its lifted bodies, and those bodies run on them (RV6)
const iarvSqlRow = (row) => {
  const o = {};
  for (const k of Object.keys(row || {})) if (row[k] !== null && row[k] !== undefined) o[k] = row[k];
  return o;
};
const iarvSqlRows = (rows) => iaList(rows).filter((r) => r && typeof r === "object").map(iarvSqlRow);
const iarvJRows = (rows) => iaRows(rows).map(iarvSqlRow);
const iarvSearch = (rows, uncapped) => ({ total: rows.length, count: rows.length, data: uncapped ? new __Uncapped(rows) : rows });
const iarvGet = (row) => (row ? { count: 1, data: row } : { count: 0, data: {} });
// the header as get_node_iaRvIa read it, with the status the classic would have seen (`statusSeen`)
const iarvHeaderSeen = (hdr, organizationId, statusSeen) =>
  hdr && iaS(hdr.id) && iaS(hdr.organization_id) === iaS(organizationId) ? Object.assign({}, hdr, { item_assembly_status: statusSeen }) : null;

// code_node_iaRvParams + code_node_iaRvPrep on the classic's round-1 inputs; P = { iaId, iaNo, organizationId }
const iarvRunPrep = function iarvRunPrep(header, moveRows, batchRows, P) {
  const ctx = {
    "workflowparams:ia_id": P.iaId, "workflowparams:ia_no": P.iaNo, "workflowparams:organization_id": P.organizationId,
    "node:get_node_iaRvIa": { data: iarvGet(header) }, "node:sql_node_iaRvMovs": { data: moveRows }, "node:search_node_iaRvBatch": { data: iarvSearch(batchRows, false) },
  };
  return __withContext(ctx, () => {
    const params = __run("code_node_iaRvParams");
    const prep = __run("code_node_iaRvPrep");
    return { params: params, prep: prep, ctx: ctx };
  });
};

// code_node_iaRvBuild after iarvRunPrep (its context carries the round-1 nodes and prep's output); R = the round-2 rows
const iarvRunBuild = function iarvRunBuild(run, R) {
  const ctx = Object.assign({}, run.ctx, {
    "node:sql_node_iaRvFifo": { data: R.fifo }, "node:sql_node_iaRvWa": { data: R.wa }, "node:sql_node_iaRvCostCounts": { data: R.costcounts },
    "node:search_node_iaRvItemBal": { data: iarvSearch(R.itemBal, true) }, "node:search_node_iaRvBatchBal": { data: iarvSearch(R.batchBal, true) },
    "node:search_node_iaRvHu": { data: iarvSearch([], false) }, "node:search_node_iaRvItems": { data: iarvSearch(R.items, true) },
  });
  return __withContext(ctx, () => __run("code_node_iaRvBuild"));
};

// what SUBMIT and PREPARE take from prep: the live rows the classic would reverse (liveOut + liveIn)
const iarvLive = function iarvLive(prep) {
  const out = iaList(prep.liveOut);
  const inn = iaList(prep.liveIn);
  return { liveOut: out.length, liveIn: inn.length, liveRows: out.length + inn.length, hu: out.concat(inn).filter((r) => iaS(r.handling_unit_id) !== "").length,
    items: Array.from(new Set(out.concat(inn).map((r) => iaS(r.item_id)).filter((x) => x))) };
};
// prep's id lists (orNone's "-1" when empty) -> a digit list for SQL ("0" first); null when one is not an id
const iarvIdsSql = (arr) => {
  const ids = iaList(arr).map(iaS).filter((v) => v !== "-1");
  if (ids.some((v) => !iaDigits(v))) return null;
  return iaIdsSql(ids);
};
// an 8-dp decimal as one canonical text ("0E-8" and 0 are the same value), null kept: the COST part's before-values
const iarvDec = (v) => (v === null || v === undefined || iaS(v) === "" ? null : iaQ8(v).toFixed(8));
