// GD Edit V2 - the save-time auto allocation, lifted: GOODS_DELIVERY v242's if_xiZFVXy2 (collectIdsForBatchFetch, the UOM /
// bin / HU searches, then per row needing one: getCurrentRowData, Global Allocation Params, the GLOBAL_ALLOCATION call, Get
// Batch ID / Get Batch No, process Allocation Result, updateRowInTableGd, with the tableGD / tracker / index caches) and
// GLOBAL_ALLOCATION v34 itself (IF Data not Valid, Get Item + Normalise Item, the batch or plain balance search, the
// pending + allocated-HU searches when isPending, Get Own Reserved, Execute Allocation), on set-based reads.
// A = { uoms, bins, huItems, hus, items, itemBalances, batchBalances, pending, huAllocated, ownReserved, batches }: rows in
// the platform's search-record shape (ids as strings, nulls dropped); every search's own filter is applied here.
const geGlobalAllocation = function geGlobalAllocation(p, A) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const num = (v) => Number(v || 0);
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const isNull = (v) => v === undefined || v === null || v === "";
  const search = (rows) => ({ total: rows.length, count: rows.length, data: rows });
  // if_3mHEuJow -> return_node_f4hAPru0
  if (isNull(p.material_id) || num(p.quantity) <= 0 || isNull(p.plant_id) || isNull(p.organization_id) || isNull(p.allocationType)) return { code: "400", message: "Data is incomplete", allocationData: [] };
  const ctx = {};
  for (const k of Object.keys(p)) ctx["workflowparams:" + k] = p[k];
  return __withContext(ctx, () => {
    const mat = s(p.material_id);
    // code_node_ItemSqlParams (digits only) -> sql_node_ItemAlloc
    __set("node:sql_node_ItemAlloc", { data: /^[0-9]+$/.test(mat) ? list(A.items).filter((r) => s(r.id) === mat) : [] });
    const norm = __run("code_node_ItemNorm");
    // if_TtxL5yA9 -> return_node_ClHo7ok7
    if (num(norm.itemFound) === 0) return { code: "400", message: "Item not found or being deleted", allocationData: [] };
    const at = (r) => s(r.material_id) === mat && s(r.plant_id) === s(p.plant_id);
    // if_XPr9mVTE: search_node_ARAmvXyd / search_node_mb8Vv8fZ (material, organization, plant)
    if (num(norm.isBatchManaged) === 1) __set("node:search_node_ARAmvXyd", { data: search(list(A.batchBalances).filter((r) => at(r) && s(r.organization_id) === s(p.organization_id))) });
    else __set("node:search_node_mb8Vv8fZ", { data: search(list(A.itemBalances).filter((r) => at(r) && s(r.organization_id) === s(p.organization_id))) });
    // if_xWXCj_YZ: search_node_BOywHct7 (Pending of this SO line) + search_node_WGl1NGSu (Allocated with a handling unit)
    if (num(p.isPending) === 1) {
      __set("node:search_node_BOywHct7", { data: search(list(A.pending).filter((r) => at(r) && s(r.parent_line_id) === s(p.parent_line_id) && s(r.status) === "Pending")) });
      __set("node:search_node_WGl1NGSu", { data: search(list(A.huAllocated).filter((r) => at(r) && s(r.status) === "Allocated" && !isNull(r.handling_unit_id))) });
    }
    // search_node_OwnReserved01: this delivery's own loose Allocated rows
    __set("node:search_node_OwnReserved01", { data: search(list(A.ownReserved).filter((r) => at(r) && s(r.target_gd_id) === s(p.currentDocId) && s(r.status) === "Allocated" && isNull(r.handling_unit_id))) });
    const r = __run("code_node_hDa6pSw5");
    // return_node_UwhI5ag5
    return { code: r.code, message: r.message, allocationData: r.allocationData };
  });
};
// runs inside the head context (geChain's), after code_node_kJx9p9Nh; answers the table get_cache_node_wiBIs4cB reads, or
// the stop return_node_5P3FRqSV makes (GLOBAL_ALLOCATION's 400: the save ends with its message)
const geAllocLoop = function geAllocLoop(A) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
  const read = (id, v) => __set("node:" + id, { data: v });
  const search = (rows) => ({ total: rows.length, count: rows.length, data: rows });
  const ids = (v) => new Set(list(Array.isArray(v) ? v : [v]).map(s));
  // a cache hands a stored array / object back as a value (the set stored its JSON text)
  const cached = (v) => { if (typeof v !== "string") return JSON.parse(JSON.stringify(v === undefined ? null : v)); try { return JSON.parse(v); } catch (e) { return v; } };
  const pre = __v("node:code_node_kJx9p9Nh.data") || {};
  const rows = list(pre.rowsNeedingAllocation);
  const col = __run("code_node_SqL4Tv8v");
  read("search_node_pltmkkw3", search(list(A.uoms).filter((u) => ids(col.uomIds).has(s(u.id)))));
  read("search_node_nbpWEAFx", search(list(A.bins).filter((b) => s(b.plant_id) === s(pre.plantId) && s(b.organization_id) === s(pre.organizationId))));
  const mats = new Set(rows.map((r) => s(r.materialId)));
  const huItems = list(A.huItems).filter((h) => mats.has(s(h.material_id)));
  read("search_node_D8ZGHKZI", search(huItems));
  const huIds = new Set(huItems.map((h) => s(h.handling_unit_id)));
  const plant = s(__v("workflowparams:allData.plant_id")), org = s(__v("workflowparams:allData.organization_id"));
  read("search_node_l8oiJ60B", search(list(A.hus).filter((h) => s(h.plant_id) === plant && s(h.organization_id) === org && huIds.has(s(h.id)))));
  // set_cache_node_qbPyqWAt / zI6dkbWZ / cysmSDlD
  let tableGD = cached(__v("workflowparams:allData.table_gd")), tracker = {}, index = 0;
  for (let i = 0; i < rows.length; i++) {
    read("get_cache_node_6hmHAVwX", cached(tableGD));
    read("get_cache_node_QGhmYUxQ", cached(tracker));
    read("get_cache_node_ih80ef3f", index);
    __run("code_node_aay7z3VT");
    const P = __run("code_node_Htpcyp8t");
    // workflow_node_NwRLmxNW: the params as the callee receives them (a JSON text declared string arrives parsed)
    const p = {};
    for (const k of Object.keys(P)) p[k] = typeof P[k] === "string" && /^[[{]/.test(P[k]) ? cached(P[k]) : P[k];
    const ga = geGlobalAllocation(p, A);
    read("workflow_node_NwRLmxNW", ga);
    // if_0xdt03Q7 -> return_node_5P3FRqSV
    if (s(ga.code) === "400") return { stop: { code: "400", message: s(ga.message) } };
    const b = __run("code_node_1Ya3sACY");
    // if_2-JyKcnS: Get Batch No only when a batch id came back (else the node keeps its last output, as on the platform)
    if (b.batch_id !== undefined && b.batch_id !== null && b.batch_id !== "") read("search_node_xc9mUWL8", search(list(A.batches).filter((x) => ids(b.batch_id).has(s(x.id)))));
    __run("code_node_hifFKzmo");
    const u = __run("code_node_56IOJIBu");
    tableGD = cached(u.tableGD);
    tracker = __v("node:code_node_56IOJIBu.data.updatedTracker");
    tracker = cached(tracker);
    index = __v("node:code_node_aay7z3VT.data.nextIndex");
  }
  return { tableGD: cached(tableGD) };
};
