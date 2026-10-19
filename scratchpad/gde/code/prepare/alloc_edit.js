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
  const binsS = search(list(A.bins).filter((b) => s(b.plant_id) === s(pre.plantId) && s(b.organization_id) === s(pre.organizationId)));
  read("search_node_nbpWEAFx", binsS);
  const mats = new Set(rows.map((r) => s(r.materialId)));
  const huItems = list(A.huItems).filter((h) => mats.has(s(h.material_id)));
  read("search_node_D8ZGHKZI", search(huItems));
  const huIds = new Set(huItems.map((h) => s(h.handling_unit_id)));
  const plant = s(__v("workflowparams:allData.plant_id")), org = s(__v("workflowparams:allData.organization_id"));
  const husS = search(list(A.hus).filter((h) => s(h.plant_id) === plant && s(h.organization_id) === org && huIds.has(s(h.id))));
  read("search_node_l8oiJ60B", husS);
  // set_cache_node_qbPyqWAt / zI6dkbWZ / cysmSDlD. The per-row nodes run in a context holding only what they read
  // (test/test_alloc_fast.js pins it): every __v copies its value, so the whole table / allData per row was O(n^2).
  let T = cached(__v("workflowparams:allData.table_gd")), tracker = {};
  const orig = pre.rowsNeedingAllocation;
  const light = Array.isArray(orig) ? orig.map((r) => (r && typeof r === "object" ? { materialId: r.materialId } : r)) : orig;
  const xc = __v("node:search_node_xc9mUWL8");
  const loopCtx = {
    "workflowparams:allData": { is_select_picking: __v("workflowparams:allData.is_select_picking"), id: __v("workflowparams:allData.id"), gd_status: __v("workflowparams:allData.gd_status") },
    "node:code_picking_defaults": { data: { effectiveSetup: __v("node:code_picking_defaults.data.effectiveSetup") } },
    "node:search_node_l8oiJ60B": { data: husS },
    "node:search_node_pltmkkw3": { data: __v("node:search_node_pltmkkw3.data") },
    // code_node_hifFKzmo only finds a bin by id for its bin_location_combine
    "node:search_node_nbpWEAFx": { data: search(binsS.data.map((b) => (b.bin_location_combine === undefined ? { id: b.id } : { id: b.id, bin_location_combine: b.bin_location_combine }))) },
  };
  if (xc !== null) loopCtx["node:search_node_xc9mUWL8"] = xc;
  for (let i = 0; i < rows.length; i++) {
    const r = __withContext(loopCtx, () => {
      // row i (code_node_aay7z3VT's index runs 0, 1, 2 ...): code_node_aay7z3VT reads rowsNeedingAllocation[index], so it gets
      // that row alone at index 0; code_node_Htpcyp8t maps every row to its material, so it gets the materials only
      const one = Array.isArray(orig) && i < orig.length;
      read("code_node_kJx9p9Nh", { rowsNeedingAllocation: one ? [orig[i]] : orig });
      read("get_cache_node_ih80ef3f", one ? 0 : i);
      __run("code_node_aay7z3VT");
      read("code_node_kJx9p9Nh", { rowsNeedingAllocation: light });
      // the tracker is read and rewritten for the row's own material only: that entry goes in, and comes back merged
      const sliced = one && orig[i] && typeof orig[i] === "object" && tracker !== null && typeof tracker === "object";
      const mk = sliced ? String(orig[i].materialId) : "";
      read("get_cache_node_QGhmYUxQ", sliced ? (Object.prototype.hasOwnProperty.call(tracker, mk) ? { [mk]: tracker[mk] } : {}) : tracker);
      read("get_cache_node_6hmHAVwX", T);
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
      const h = __run("code_node_hifFKzmo");
      // updateRowInTableGd writes its row and the cross-line rows only: it gets just the top-level rows holding them, its
      // indexes renumbered in that short table's flat walk, and the rows it returns go back in place
      const touched = new Set([h.rowIndex].concat(Object.keys(h.crossLineUpdates || {}).map((x) => parseInt(x))));
      const keep = [], at = {};
      let f = 0, c = 0;
      T.forEach((row, k) => {
        const span = 1 + (row && Array.isArray(row.children) ? row.children.length : 0);
        let hit = false;
        for (let x = f; x < f + span; x++) if (touched.has(x)) hit = true;
        if (hit) { keep.push(k); for (let x = 0; x < span; x++) at[f + x] = c + x; c += span; }
        f += span;
      });
      const to = (v) => (Object.prototype.hasOwnProperty.call(at, v) ? at[v] : -1);
      const cl = {};
      for (const [k, v] of Object.entries(h.crossLineUpdates || {})) if (to(parseInt(k)) >= 0) cl[to(parseInt(k))] = v;
      read("code_node_hifFKzmo", Object.assign({}, h, { rowIndex: to(h.rowIndex), crossLineUpdates: cl }));
      read("get_cache_node_6hmHAVwX", keep.map((k) => T[k]));
      const u = __run("code_node_56IOJIBu");
      keep.forEach((k, j) => { T[k] = u.tableGD[j]; });
      // the platform's output keeps no null keys: from the first row on, the whole table comes back that way
      if (i === 0) T = __strip(T);
      const out = u.updatedTracker === undefined ? null : u.updatedTracker;
      if (sliced && out !== null && typeof out === "object") for (const k of Object.keys(out)) tracker[k] = out[k];
      else tracker = out;
      return null;
    });
    if (r && r.stop) return r;
  }
  return { tableGD: T };
};
