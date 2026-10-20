// LOT_V2_PREPARE - the classic auto allocation (V2.1, CONTRACT.md section 9), lifted. SM_LOCATION_TRANSFER v82's if_LOTallocGate branch:
// code_node_LOTallocPrep, then per row needing one LOTallocCurrent -> LOTallocParams -> GLOBAL_ALLOCATION v34 -> LOTallocResult,
// with the lines / tracker / index caches kept here; GLOBAL_ALLOCATION runs in-process on set-based reads (aitem / abal).
// geGlobalAllocation below is a copy of scratchpad/gde/code/prepare/alloc_edit.js's, unchanged (GD Edit V2, deployed dev).
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
// the items prepare/sql.py CAND read balances for: the same rule, on the stored lines (MySQL TRIM cuts spaces only)
const lotAllocScope = function lotAllocScope(rawLines, scope) {
  const ids = new Set();
  if (scope !== "EMPTY" && scope !== "REQ") return ids;
  for (const l of lotList(rawLines)) {
    if (!(Number(l.requested_qty) > 0) || !lotS(l.item_selection)) continue;
    const t = l.temp_qty_data === undefined || l.temp_qty_data === null ? "" : String(l.temp_qty_data).replace(/^ +| +$/g, "");
    if (scope === "EMPTY" && t !== "" && t !== "[]") continue;
    ids.add(lotS(l.item_selection));
  }
  return ids;
};
// runs inside lotChain's context, before yPlLXIZW. Each per-row node gets only what it reads (every __v copies its value, so the
// whole lines / tracker per row would be O(n^2); gde test_alloc_fast.js): LOTallocCurrent its row alone at index 0,
// LOTallocParams the tracker entry of its row's material, LOTallocResult its own line alone (at index 0) and an empty tracker -
// the line and the line's bucket go back in place. -> { route: NONE | DONE | STOP | SCOPE, lines (the cache get_cache_node_LOTallocOut
// hands yPlLXIZW), done (the flat indexes allocated, in order), message, row, line }. SCOPE: a row whose item / plant the reads did
// not cover (where = the stored plant and organization the balances were read at). storedPicks (COMPLETE / EDIT): { <line id>:
// its STORED entries } - those picks already left their bins (In Transit / at the target), so for that row's call only they are
// added back onto copies of the matching Unrestricted balance rows (material | bin | batch, base uom); the reconcile then moves
// just the delta
const lotAllocLoop = function lotAllocLoop(A, scope, where, storedPicks) {
  const s = lotS;
  const prep = __run("code_node_LOTallocPrep");
  const rows = lotList(prep.rowsNeedingAllocation);
  if (Number(prep.hasRows) !== 1 || !rows.length) return { route: "NONE", lines: null, done: [] };
  const lines = lotList(prep.snapshot).slice();
  const byMat = (list) => {
    const m = {};
    for (const r of lotList(list)) (m[s(r.material_id)] = m[s(r.material_id)] || []).push(r);
    return m;
  };
  const items = {};
  for (const it of lotList(A.items)) items[s(it.id)] = it;
  const ib = byMat(A.itemBalances);
  const ibb = byMat(A.batchBalances);
  const tracker = {};
  const done = [];
  const backOf = (mat, line) => {
    const ents = storedPicks && line ? storedPicks[s(line.id)] : null;
    if (!Array.isArray(ents) || !ents.length) return null;
    const conv = lotJsonList((items[mat] || {}).uom_conversion_json);
    const add = {};
    for (const e of ents) {
      const q = lotQ8(e && e.sm_quantity);
      if (q <= 0 || s(e.material_id || mat) !== mat || lotCategory(s(e.category) || "Unrestricted") !== "Unrestricted" || s(e.handling_unit_id)) continue;
      const c = conv.filter((x) => x && s(x.alt_uom_id) === s(e.material_uom))[0];
      const k = s(e.location_id) + "|" + (lotIdStr(e.batch_id) || "");
      add[k] = lotQ8((add[k] || 0) + q * (c && parseFloat(c.base_qty) ? parseFloat(c.base_qty) : 1));
    }
    return Object.keys(add).length ? add : null;
  };
  const withBack = (rows, add) => (add ? lotList(rows).map((r) => {
    const k = s(r.location_id) + "|" + (lotIdStr(r.batch_id) || "");
    return add[k] ? Object.assign({}, r, { unrestricted_qty: lotQ8((parseFloat(r.unrestricted_qty) || 0) + add[k]) }) : r;
  }) : rows || []);
  const loopCtx = { "workflowparams:allData": { id: __v("workflowparams:allData.id") } };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const mat = s(row.materialId);
    if (!(row.lineIndex >= 0 && row.lineIndex < lines.length)) return { route: "SCOPE", lines: null, done: done, row: row, line: null };
    if (!scope.has(mat) || s(row.plantId) !== s(where.plant) || s(row.organizationId) !== s(where.org)) return { route: "SCOPE", lines: null, done: done, row: row, line: lines[row.lineIndex] };
    const res = __withContext(loopCtx, () => {
      __set("node:code_node_LOTallocPrep", { data: { rowsNeedingAllocation: [row] } });
      __set("node:get_cache_node_LOTallocIdxIn", { data: "0" });
      const cur = __run("code_node_LOTallocCurrent");
      __set("node:get_cache_node_LOTallocTrackerIn", { data: Object.prototype.hasOwnProperty.call(tracker, mat) ? { [mat]: tracker[mat] } : {} });
      const P = __run("code_node_LOTallocParams");
      // workflow_node_LOTallocRun: the params as the callee receives them (a JSON text declared string arrives parsed)
      const p = {};
      for (const k of Object.keys(P)) p[k] = typeof P[k] === "string" && /^[[{]/.test(P[k]) ? lotParseJ(P[k]) : P[k];
      const add = backOf(mat, lines[row.lineIndex]);
      const ga = geGlobalAllocation(p, { items: items[mat] ? [items[mat]] : [], itemBalances: withBack(ib[mat], add), batchBalances: withBack(ibb[mat], add), pending: [],
        huAllocated: [], ownReserved: [] });
      __set("node:workflow_node_LOTallocRun", { data: ga });
      // if_LOTallocErr -> return_node_LOTallocErr
      if (s(ga.code) === "400") return { stop: s(ga.message) };
      __set("node:code_node_LOTallocCurrent", { data: Object.assign({}, cur, { currentRow: Object.assign({}, cur.currentRow, { lineIndex: 0 }) }) });
      __set("node:get_cache_node_LOTallocLinesIn", { data: [lines[row.lineIndex]] });
      __set("node:get_cache_node_LOTallocTrackerIn", { data: {} });
      const r = __run("code_node_LOTallocResult");
      const t = r.allocationTracker && typeof r.allocationTracker === "object" ? r.allocationTracker[mat] : null;
      return { line: lotList(r.updatedLines)[0], bucket: t && typeof t === "object" && t["0"] && typeof t["0"] === "object" ? t["0"] : {} };
    });
    if (res.stop !== undefined) return { route: "STOP", lines: null, done: done, message: res.stop, row: row, line: lines[row.lineIndex] };
    if (!res.line) return { route: "SCOPE", lines: null, done: done, row: row, line: lines[row.lineIndex] };
    lines[row.lineIndex] = res.line;
    (tracker[mat] = tracker[mat] || {})[row.lineIndex] = res.bucket;
    done.push(row.lineIndex);
  }
  return { route: "DONE", lines: lines, done: done };
};
