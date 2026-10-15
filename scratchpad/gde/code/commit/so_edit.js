// GD Edit V2 - E4's sales-order step: GOODS_DELIVERY's code_node_QtyCheckBatch, the removed-lines clean-up
// (code_node_aq0VGgxs -> code_node_GD92d7xU), code_node_UMQapdjk and code_node_lwB2FVe0 re-run (lifted) on a FRESH read of
// the SO lines and headers, from the inputs PREPARE froze (part SO). Searches are filtered here as their nodes filter.
// soLines: SO line rows (platform search shape; a superset), soHeaders: SO header rows (with table_so when the read has it).
const geSoRun = function geSoRun(so, soLines, soHeaders, extraReads) {
  const str = (v) => (v === undefined || v === null ? "" : String(v));
  const search = (rows) => ({ total: rows.length, count: rows.length, data: rows });
  const lines = (soLines || []).slice();
  const byIds = (ids) => { const set = new Set((ids || []).map(str)); return lines.filter((l) => set.has(str(l.id))); };
  const ctx = {
    "workflowparams:saveAs": "Created",
    "workflowparams:allData": { is_select_picking: so.isSelectPicking === undefined ? null : so.isSelectPicking },
    "node:code_node_hb8ZWe9c": { data: { tableGD: so.tableGD || [], bundleParents: so.bundleParents || [] } },
    "node:code_node_IyJHrBst": { data: { gd_status: so.gdStatus, needSOCleanUp: so.needSOCleanUp || 0, allData: { so_id: so.soIds === undefined ? null : so.soIds, table_gd: so.current || [] } } },
    "node:code_picking_defaults": { data: { splitPolicy: so.splitPolicy || "ALLOW_SPLIT" } },
    "node:sql_node_ItemFlags": { data: so.items || [] },
    "node:search_node_SOLine8kQ2": { data: search(byIds(so.soLineIds)) },
    // a Draft's save never read the stored GD (if_kpeBjx1k): the node has no output
    "node:get_node_xTRvHWB8": so.original === null || so.original === undefined ? { data: null } : { data: { count: 1, data: { table_gd: so.original } } },
  };
  for (const k of Object.keys(ctx)) if (ctx[k] && ctx[k].data && ctx[k].data.allData && ctx[k].data.allData.is_select_picking === null) delete ctx[k].data.allData.is_select_picking;
  // a parity test replaying an older recording seeds that version's own read nodes
  for (const [k, v] of Object.entries(extraReads || {})) ctx["node:" + k] = { data: v };
  return __withContext(ctx, () => {
    const num = (v) => Number(v || 0);
    const q = __run("code_node_QtyCheckBatch");
    if (num(q.itemNotFound) === 1) return { stop: "Material not found or has been deleted" };
    if (num(q.soLineMissing) === 1) return { stop: str(q.soLineMissingMessage) };
    if (q.validationMessage !== undefined && q.validationMessage !== null) return { stop: str(q.validationMessage) };
    if (num(so.needSOCleanUp) === 1) {
      const aq = __run("code_node_aq0VGgxs");
      __set("node:search_node_DnZIKKVH", { data: search(byIds((aq.removedItems || []).map((r) => r.so_line_item_id))) });
      __run("code_node_GD92d7xU");
    }
    __set("node:get_cache_node_alhhxRsa", { data: JSON.stringify(__v("node:code_node_QtyCheckBatch.data.updatedSOTable") || []) });
    const um = __run("code_node_UMQapdjk");
    // search_node_FVhsTRDu filters on soFetchIds (v242); a version without it read its own set (the headers as given)
    const fetch = um.soFetchIds ? new Set(um.soFetchIds.map(str)) : null;
    __set("node:search_node_FVhsTRDu", { data: search((soHeaders || []).filter((h) => !fetch || fetch.has(str(h.id)))) });
    __run("code_node_lwB2FVe0");
    return { final: __v("node:code_node_UMQapdjk.data.finalSOTable") || [], heads: __v("node:code_node_lwB2FVe0.data.updatedSOList") || [] };
  });
};
