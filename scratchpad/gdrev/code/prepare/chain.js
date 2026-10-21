// GD_REVERT_PREPARE - Chain: GD_REVERT_COMPLETED's and GD_PROCESS_REVERT's code nodes (lift/lifted_revert.js, pinned v17 / v13) on
// PREPARE's set-based reads, in the classic order, each in its own run's context; the inventory call gets the parameters
// GD_REVERT_COMPLETED passes it. Refusals carry the classic texts. upTo "ids" stops after the snapshot parse: round 2 reads the ids
// it names. Search / get shapes come from GD Completed V2's adapter (gcObj / gcTree / gcSearch / gcGet).
const GR_MSG = {
  notCompleted: "Only Completed Goods Deliveries can be reverted",
  noSnapshot: "No active snapshot found for this Goods Delivery; revert not possible (snapshot may have expired, been consumed by a previous revert, or this GD was completed before snapshots were enabled).",
  noSnapshotId: "snapshot_id required for revert (reconstruction mode not yet implemented)",
  snapshotGone: "Active snapshot not found for the given snapshot_id; revert cannot proceed",
  conflicts: "Revert blocked: state has changed since completion. Resolve conflicts manually.",
};

const grReads = function grReads(S) {
  const objs = (v) => gcRows(v).map(gcObj);
  const A = gcAdapt({ organizationId: S.organizationId, hdr: S.hdr, lines: S.lines });
  const sol = objs(S.sol);
  const soh = objs(S.soh);
  for (const h of soh) h.table_so = gcTree(sol.filter((l) => l.sales_order_id === h.id), "sales_order_id");
  const sqlRows = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return { gd: A.gd, snap: objs(S.snap), sol: sol, soh: soh, resv: objs(S.resv), pend: objs(S.pend), prec: objs(S.prec), phdr: objs(S.phdr), hu: objs(S.hu),
    hul: objs(S.hul), pick: sqlRows(S.pick), items: sqlRows(S.items), cost: sqlRows(S.cost), dout: sqlRows(S.dout) };
};

// stored: the GD as the classic revert reads it (Completed); R: grReads()
const grChain = function grChain(stored, R, upTo) {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const stop = (code, message, extra) => Object.assign({ route: "STOP", code: code, message: message }, extra || {});
  const head = { "workflowparams:allData": stored, "workflowparams:pageStatus": "Edit", "node:search_node_hrFindSnap": { data: gcSearch(R.snap) } };
  const H = (k) => __withContext(head, () => __v(k));
  const ex = __withContext(head, () => __run("code_node_hrExtract"));
  if (String(ex.isCompleted) !== "1") return stop("GDR_NOT_COMPLETED", GR_MSG.notCompleted);
  const ps = __withContext(head, () => __run("code_node_hrParseSnap"));
  if (String(ps.snapshotFound) === "0") return stop("GDR_NO_SNAPSHOT", GR_MSG.noSnapshot);
  const snapRow = R.snap.filter((r) => s(r.id) === s(ps.snapshotId))[0] || null;
  const child = {
    "workflowparams:snapshot_id": H("node:code_node_hrParseSnap.data.snapshotId"), "workflowparams:doc_id": H("node:code_node_hrExtract.data.gdId"),
    "workflowparams:gd_no": H("node:code_node_hrExtract.data.gdNo"), "workflowparams:plant_id": H("node:code_node_hrExtract.data.plantId"),
    "workflowparams:organization_id": H("node:code_node_hrExtract.data.organizationId"), "workflowparams:transaction_type": H("node:code_node_hrExtract.data.transactionType"),
    "workflowparams:doc_date": H("node:code_node_hrExtract.data.docDate"), "workflowparams:tableData": H("node:code_node_hrExtract.data.tableData"),
    "node:get_node_inSnapshot": { data: gcGet(snapRow) },
  };
  const ie = __withContext(child, () => __run("code_node_inExtract"));
  if (String(ie.hasSnapshotId) === "0") return stop("GDR_NO_SNAPSHOT", GR_MSG.noSnapshotId);
  const cs = __withContext(child, () => __run("code_node_inParseSnap"));
  if (String(cs.snapshotFound) === "0") return stop("GDR_NO_SNAPSHOT", GR_MSG.snapshotGone);
  const ids = { pendingIds: cs.pendingIds || [], pickingRecordIds: cs.pickingRecordIds || [], ppHeaderIds: cs.ppHeaderIds || [], huIds: cs.huIds || [], huLineIds: cs.huLineIds || [] };
  if (upTo === "ids") return { route: "IDS", ids: ids, snapshotId: s(ps.snapshotId) };

  const lineIds = {};
  for (const id of H("node:code_node_hrExtract.data.soLineItemIds") || []) lineIds[s(id)] = true;
  head["node:search_node_hrCurSoLines"] = { data: gcSearch(R.sol.filter((l) => lineIds[s(l.id)])) };
  head["node:search_node_hrCurSoHdr"] = { data: gcSearch(R.soh) };
  __withContext(head, () => __run("code_node_hrPickParams"));
  head["node:sql_node_hrPickFacts"] = { data: R.pick };
  __withContext(head, () => __run("code_node_hrComputeSoUpdates"));
  Object.assign(child, {
    "node:search_node_inCurReserved": { data: gcSearch(R.resv) }, "node:search_node_inCurPending": { data: gcSearch(R.pend) },
    "node:search_node_inCurPicking": { data: gcSearch(R.prec) }, "node:search_node_inCurPpHdr": { data: gcSearch(R.phdr) },
    "node:search_node_inCurHu": { data: gcSearch(R.hu) }, "node:search_node_inCurHuLn": { data: gcSearch(R.hul) },
    "node:sql_node_InItems": { data: R.items }, "node:sql_node_inDlvCost": { data: R.cost }, "node:sql_node_inDirectOut": { data: R.dout },
  });
  const cb = __withContext(child, () => __run("code_node_inConflictBatch"));
  if (String(cb.hasConflicts) === "1") return stop("GDR_CONFLICT", GR_MSG.conflicts, { conflicts: cb.conflicts || [] });
  __withContext(head, () => __run("code_node_hrPickStatus"));
  return {
    route: "PLANNED", ids: ids, snapshotId: s(ps.snapshotId),
    extract: H("node:code_node_hrExtract.data"), so: H("node:code_node_hrComputeSoUpdates.data"), pickStatus: H("node:code_node_hrPickStatus.data"),
    batch: __withContext(child, () => __v("node:code_node_inConflictBatch.data")),
  };
};
