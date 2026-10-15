// GD Edit V2 - the chain: GOODS_DELIVERY's Edit + Save as Created path (dev v242) and GD_UNUSED_FN_NEW's planner, run
// in-process on the lifted deployed bodies (lift/lifted_edit.js; gdc's lift/runtime.js) and on SQL reads. Needs gdc's
// code/prepare/chain.js loaded first (gcGdWrite, gcAfterImage). The control flow is the deployed if-nodes' (ids in comments).
// IN.params = GOODS_DELIVERY's request (allData, saveAs "Created", pageStatus "Edit", needCL, continueZero,
// confirmPickReversal); IN.reads = adapted reads; IN.stored = the GD as stored (any status; the after-image base);
// IN.mint = { line(n) -> placeholder id, number -> placeholder delivery_no }; IN.gatesOnly stops after the gates (SUBMIT);
// IN.lenient lets a parity test skip nodes its recording lacks.
const GE_DRAFT_WRITE_EXTRA = ["delivery_no_type"];
const geChain = function geChain(IN) {
  const R = IN.reads;
  const out = { route: "PLANNED", code: "200", message: "", ran: [], gates: null, write: null, afterImage: null, minted: {} };
  const run = (id) => {
    if (IN.lenient && !__N[id]) return {};
    const o = __run(id);
    out.ran.push(id);
    return o;
  };
  const read = (id, value) => __set("node:" + id, { data: value });
  const stop = (code, message) => Object.assign(out, { route: code === "NOT_ELIGIBLE" ? "NOT_ELIGIBLE" : "STOP", code: code, message: message || "" });
  const num = (v) => Number(v || 0);
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const P = IN.params;
  const all = P.allData || {};
  const isPicking = P.isPicking !== undefined && P.isPicking !== null;
  const S0 = { total: 0, count: 0, data: [] };
  const G0 = { count: 0, data: {} };
  // a superset read narrowed to the ids the deployed search node filters on (no ids: a version without them, as read)
  const searchBy = (src, ids) => {
    const rows = ((src || S0).data || []);
    if (!Array.isArray(ids)) return src || S0;
    const want = new Set(ids.map((x) => String(x)));
    const keep = rows.filter((r) => want.has(String(r.id)));
    return { total: keep.length, count: keep.length, data: keep };
  };

  const head = { "system:tenantId": IN.tenantId, "system:uuid": IN.uuid };
  for (const k of Object.keys(P)) if (P[k] !== null && P[k] !== undefined) head["workflowparams:" + k] = P[k];
  out.ctx = { head: head, callee: {}, reorder: {} };

  const chain = () => {
    // a parity test replaying an older recording seeds the read nodes that version had (e.g. search_node_w1NxF9TX)
    for (const [k, v] of Object.entries(IN.extraReads || {})) read(k, v);
    // if_gr_gate_completed (saveAs Completed or Created): GR gate. Internal-trading linkage stays on the classic save
    run("code_gr_soids");
    read("search_gr_linkage", R.linkage || S0);
    const link = run("code_gr_link");
    if (num(link.hasLink) === 1) return stop("NOT_ELIGIBLE", "internal-trading linkage (auto-GR)");
    const cover = run("code_gr_cover_ids");
    if (num(cover.doFetchSo) === 1) read("search_gr_so", R.grSo || S0);
    const grGate = run("code_gr_gate");
    // if_gr_gate
    if (num(grGate.grConfirm) !== 0 && s(P.isPicking) !== "Yes" && num(P.isPacking) !== 1) return stop("NOT_ELIGIBLE", "auto-GR confirmation");

    run("code_node_eOO3RTkR");
    const zero = run("code_node_shTWK0Nm");
    // if_H2b1nRMW
    if (num(zero.hasZero) === 1 && s(P.continueZero) !== "Yes" && !isPicking) return stop("401", zero.message || "");

    // cond_all_gd_fetch
    read("get_node_iFPuvJX2", R.pickingSetup || G0);
    read("sql_node_ItemFlags", R.itemFlags || []);
    read("get_packing_setup", R.packingSetup || G0);
    const defaults = run("code_picking_defaults");
    // if_WDczQjqt: auto allocation of the rows without one (the classic GLOBAL_ALLOCATION loop; its result is the cached table)
    if (defaults.pickingMode === "Auto" && !isPicking) {
      const prep = run("code_node_kJx9p9Nh");
      // if_xiZFVXy2
      if (num(prep.totalRowsToAllocate) > 0) {
        // a replay hands the table as the run cached it; PREPARE and SUBMIT hand the set-based reads (alloc_edit.js)
        if (R.allocTable !== undefined && R.allocTable !== null) read("get_cache_node_wiBIs4cB", R.allocTable);
        else if (R.alloc) {
          const loop = geAllocLoop(R.alloc);
          // return_node_5P3FRqSV: GLOBAL_ALLOCATION's 400 ends the save with its message
          if (loop.stop) return stop(loop.stop.code, loop.stop.message);
          read("get_cache_node_wiBIs4cB", JSON.stringify(loop.tableGD));
        } else return stop("NOT_ELIGIBLE", "lines without an allocation");
      }
      run("code_node_ymugKpln");
    }

    // if_kpeBjx1k: the stored GD and its Picking are read only when the page sent gd_status Created
    if (s(all.gd_status) === "Created") {
      read("get_node_xTRvHWB8", R.gd || G0);
      read("get_pick_for_reconcile", R.pick || G0);
      const stored = (R.gd || G0).data || {};
      // if_amlgRu7I -> if_o5z3RcOy
      if ((stored.picking_status === "In Progress" || stored.picking_status === "Completed") && num(defaults.pickReconcileSupported) === 0 && !isPicking) {
        return stop("400", s(defaults.pickBlockMessage));
      }
      // if_j38KWlWo
      if (num(defaults.allowFullPicking) === 1 && (stored.picking_status === "Created" || stored.picking_status === "In Progress")) {
        read("search_node_NBAQ9gsj", R.activePickings || S0);
      }
    }
    const fill = run("code_node_IyJHrBst");
    // if_vnwLSl9x
    if (num(fill.invalidData) === 1) return stop("400", s(fill.invalidDataMessage));
    const rec = run("code_pick_reconcile");
    // if_pick_block
    if (num(rec.blockCreatedEdit) === 1) return stop("400", s(rec.blockMessage));
    // if_pick_has_reversal -> if_pick_reversal_confirm
    let reversal = null;
    if (num(rec.hasReversals) === 1) {
      read("search_bin_names", R.binNames || S0);
      reversal = run("code_pick_reversal_msg");
      if (num(rec.needsReversalConfirm) === 1) return stop("413", s(reversal.confirmMessage));
    }
    out.pickingReversalNote = reversal ? s(reversal.noticeMessage) : "";

    const eid = run("code_node_EIDz5y7I");
    // workflow_node_0jaUJbQD (CHECK_REQUIRED_FIELD) -> if_KTzHecEc: SUBMIT runs it in-process (gdc's gsRequired) through
    // IN.checkRequired; a parity test passes the recorded answer as R.checkRequired; PREPARE (already checked) neither
    if (typeof IN.checkRequired === "function") {
      const cr = IN.checkRequired(eid.data, eid.required_fields) || {};
      if (s(cr.status) === "Failed") return stop("400", s(cr.message));
    } else if (R.checkRequired !== undefined && R.checkRequired !== null) {
      read("workflow_node_0jaUJbQD", R.checkRequired);
      const cr = ((R.checkRequired || {}).data || {});
      if (s(cr.status) === "Failed") return stop("400", s(cr.message));
    }
    run("code_node_8pN1MyXz");
    // if_pIBgoMN3 (needCL required): CREDIT_LIMIT_CHECK is SUBMIT's (402 / 403 / the override note), never repeated here

    // if_qAbmxB8R (saveAs != Draft)
    run("code_node_hb8ZWe9c");
    read("search_node_SOLine8kQ2", searchBy(R.soLines, __v("node:code_node_hb8ZWe9c.data.soLineIds")));
    const qty = run("code_node_QtyCheckBatch");
    // if_9DC5Lah8, if_SoLineGone, if_ACsN1GZD -> if_I5UTovzN. GOODS_DELIVERY answers its credit limit (402 / 403) BEFORE
    // these: in gates-only mode (SUBMIT) they are reported for its post step, which calls CREDIT_LIMIT_CHECK first
    const qtyStop = num(qty.itemNotFound) === 1 ? "Material not found or has been deleted" : num(qty.soLineMissing) === 1 ? s(qty.soLineMissingMessage)
      : qty.validationMessage !== undefined && qty.validationMessage !== null ? s(qty.validationMessage) : "";
    if (!IN.gatesOnly && qtyStop) return stop("400", qtyStop);
    out.qtyStop = qtyStop;
    const si = run("code_si_gate");
    // if_si_gate (a Completed-only question)
    if (num(si.siConfirm) === 412) return stop("NOT_ELIGIBLE", "auto-SI confirmation");
    out.needCL = s(fill.needCL);
    out.clAutoOverride = s(fill.clAutoOverride);
    if (IN.gatesOnly) return Object.assign(out, { route: "GATES" });

    run("code_node_GKc0ALEe");

    // if_vm23aYTD: the pre-flight check is replaced by INVENTORY_BULK_APPLY PLAN; workflow_node_ReorderCreated
    // (if_ReorderCreated) runs in its own context with the stored lines (null for a Draft) and the latest
    if (s(all.is_select_picking) !== "1") {
      out.ctx.reorder = {
        "system:tenantId": IN.tenantId, "system:uuid": IN.uuid, "workflowparams:document_type": "GD_CREATED",
        "workflowparams:previous_data": __v("node:get_node_xTRvHWB8.data.data.table_gd"), "workflowparams:latest_data": __v("node:code_node_hb8ZWe9c.data.tableGD"),
      };
      for (const k of Object.keys(out.ctx.reorder)) if (out.ctx.reorder[k] === null) delete out.ctx.reorder[k];
      out.reorder = __withContext(out.ctx.reorder, () => run("code_node_f8qELJUF"));
    }

    // if_yjDL1tIt (Edit) -> if_63JLcYAM: the stored-Created write (update_node_elLmtlLm, table_gd + picking_status from
    // code_node_PkMerge) or the stored-Draft write (update_node_aJCo6wbf: + delivery_no_type, table_gd from code_node_GKc0ALEe)
    const fillAll = __v("node:code_node_IyJHrBst.data.allData") || {};
    const fmtAll = __v("node:code_node_GKc0ALEe.data.allData") || {};
    const isDraft = s(fill.gd_status) === "Draft";
    let merge;
    if (!isDraft) {
      // if_PkMergeGd: needMerge is "1" only for a Picking's own save, never for an edit
      if (IN.lenient && !__N["code_node_PkMerge"]) merge = { table_gd: fmtAll.table_gd, picking_status: __v("node:code_node_8pN1MyXz.data.picking_status") };
      else merge = run("code_node_PkMerge");
    } else merge = { table_gd: fmtAll.table_gd, picking_status: __v("node:code_node_8pN1MyXz.data.picking_status") };
    out.write = gcGdWrite(fillAll, fmtAll, merge, P.saveAs);
    if (isDraft) for (const c of GE_DRAFT_WRITE_EXTRA) out.write.header[c] = fillAll[c] === undefined ? null : fillAll[c];
    if (IN.stored) out.afterImage = geMint(geEmptyJson(gcAfterImage(IN.stored, out.write, IN.kinds), out.write, IN.stored, IN.kinds), out.write, IN.mint, out.minted);
    const backId = isDraft ? "get_node_ZaAPFTIP" : "get_node_Cef6vdH4";
    if (R.afterGd) read(backId, R.afterGd);
    else if (out.afterImage) read(backId, { count: 1, data: out.afterImage });
    else return stop("500", "no read-back of the GD write (stored GD missing)");
    const gdd = run("code_node_Pgtw6zFL");
    if (num(gdd.isGDPP) === 1) return stop("NOT_ELIGIBLE", "GD from a Picking Plan");

    // if_JqMwMUYp: lines removed from the delivery
    if (num(fill.needSOCleanUp) === 1) {
      const aq = run("code_node_aq0VGgxs");
      read("search_node_DnZIKKVH", searchBy(R.cleanupSoLines, Array.isArray(aq.removedItems) ? aq.removedItems.map((r) => r.so_line_item_id) : undefined));
      run("code_node_GD92d7xU");
    }
    // set_cache_node_Kij5KaiV -> get_cache_node_alhhxRsa (the cache holds the JSON text)
    read("get_cache_node_alhhxRsa", JSON.stringify(__v("node:code_node_QtyCheckBatch.data.updatedSOTable") || []));
    const um = run("code_node_UMQapdjk");
    read("search_node_FVhsTRDu", searchBy(R.soHeaders, um.soFetchIds));
    run("code_node_lwB2FVe0");

    // workflow_node_hRMvSe8u -> GD_UNUSED_FN_NEW (its own context), parameters as its body_params map them
    const callee = {
      "system:tenantId": IN.tenantId, "system:uuid": IN.uuid,
      "workflowparams:doc_id": __v("node:code_node_Pgtw6zFL.data.gdData.id"),
      "workflowparams:plant_id": __v("node:code_node_Pgtw6zFL.data.gdData.plant_id"),
      "workflowparams:organization_id": __v("node:code_node_Pgtw6zFL.data.gdData.organization_id"),
      "workflowparams:page_status": __v("workflowparams:pageStatus"),
      "workflowparams:saveAs": __v("workflowparams:saveAs"),
      "workflowparams:doc_no": __v("node:code_node_Pgtw6zFL.data.gdData.delivery_no"),
      "workflowparams:parent_id": __v("node:code_node_Pgtw6zFL.data.gdData.so_id"),
      "workflowparams:parent_no": __v("node:code_node_Pgtw6zFL.data.gdData.so_no"),
      "workflowparams:tableData": __v("node:code_node_Pgtw6zFL.data.gdData.table_gd"),
      "workflowparams:doc_status": __v("node:code_node_IyJHrBst.data.gd_status"),
      "workflowparams:doc_date": __v("node:code_node_Pgtw6zFL.data.gdData.delivery_date"),
      "workflowparams:isGDPP": __v("node:code_node_Pgtw6zFL.data.isGDPP"),
      "workflowparams:picking_plan_id": __v("node:code_node_Pgtw6zFL.data.picking_plan_id"),
      "workflowparams:transaction_type": "GDL",
      "workflowparams:isPacking": __v("workflowparams:isPacking"),
      "workflowparams:isLoadingBay": __v("workflowparams:isLoadingBay"),
    };
    for (const k of Object.keys(callee)) if (callee[k] === null) delete callee[k];
    out.ctx.callee = callee;
    out.unused = __withContext(callee, () => {
      for (const [k, v] of Object.entries(IN.calleeExtraReads || {})) read(k, v);
      run("code_node_SSWylCan");
      read("sql_node_ItemDatas", R.itemDatas || []);
      read("search_node_r3NiR6B7", R.allocated || S0);
      read("search_node_QdY1FLLA", R.pending || S0);
      read("search_node_PpDelivRec01", S0);
      run("code_node_eOMvMZOj");
      run("code_node_b71wypDJ");
      const exec = run("code_node_QrF4F4Hx");
      // Branch 4 (isGDPP) is refused above; Branch 5 (HU) never runs on Created
      return { code: exec.code === "400" ? "400" : "200", message: exec.message, exec: exec };
    });
    // if_fLWMe4c5
    if (out.unused.code === "400") return stop("400", out.unused.message || "GD_UNUSED_FN_NEW planner failed");

    // if_9xhwui06: create / update the Picking
    const recNow = __v("node:code_pick_reconcile.data") || {};
    const pickBranch = num(defaults.pickingRequired) === 1 && s(P.saveAs) === "Created"
      && (num(defaults.autoTriggerTo) === 1 || num(recNow.reconcileNeeded) === 1 || num(recNow.pickingLinked) === 1)
      && !isPicking && (s(fill.picking_status) !== "Completed" || num(recNow.reconcileNeeded) === 1) && num(grGate.skipPicking) === 0;
    out.pickBranch = pickBranch ? 1 : 0;
    if (pickBranch) {
      read("get_node_zna6o03F", R.pickingFormat || G0);
      run("code_node_o35eZx2c");
      run("code_node_6L2Ozea8");
    }
    run("code_pick_hdr_sync");
    run("code_node_62FzZA2e");
    run("code_node_cv51vgiy");
    return out;
  };
  return __withContext(head, chain);
};

// a json column written as [] is not written: it reads back as stored (gd_ref_doc NULL on GD/20260915/526 stays absent,
// assigned_to [] stays []); the Picking copies gd_ref_doc
const geEmptyJson = function geEmptyJson(after, write, stored, kinds) {
  const H = (kinds && kinds.header) || {};
  const L = (kinds && kinds.line) || {};
  const keep = (o, w, st, K) => {
    for (const k of Object.keys(w || {})) {
      if (!(K[k] && K[k][0] === "json" && Array.isArray(w[k]) && w[k].length === 0)) continue;
      if (st && st[k] !== undefined) o[k] = JSON.parse(JSON.stringify(st[k]));
      else delete o[k];
    }
  };
  keep(after, write.header, stored, H);
  const storedRows = {};
  for (const r of stored.table_gd || []) { storedRows[String(r.id)] = r; for (const c of r.children || []) storedRows[String(c.id)] = c; }
  const written = {};
  for (const r of write.table_gd || []) { if (r.id) written[String(r.id)] = r; for (const c of r.children || []) if (c.id) written[String(c.id)] = c; }
  for (const r of after.table_gd || []) {
    keep(r, written[String(r.id)], storedRows[String(r.id)], L);
    for (const c of r.children || []) keep(c, written[String(c.id)], storedRows[String(c.id)], L);
  }
  return after;
};

// the platform's read-back assigns what the write leaves to it: an id for each inserted line (a child keeps its new
// parent's id) and, on a Draft saved as Created, the serial number that replaces the 'issued' sentinel. Placeholders
// stand in for them until COMMIT writes; `minted` records which.
const geMint = function geMint(after, write, mint, minted) {
  const m = mint || {};
  let n = 0;
  const newId = () => {
    n++;
    return m.line ? m.line(n) : "9" + String(n).padStart(18, "0");
  };
  minted.lines = [];
  for (const r of after.table_gd || []) {
    if (r.id === undefined) { r.id = newId(); minted.lines.push(r.id); }
    for (const c of r.children || []) {
      if (c.id === undefined) { c.id = newId(); minted.lines.push(c.id); }
      c.parent_id = r.id;
    }
  }
  if (write && write.header && write.header.delivery_no === "issued") {
    after.delivery_no = m.number || "#GDE-DELIVERY-NO#";
    minted.number = after.delivery_no;
  }
  return after;
};
