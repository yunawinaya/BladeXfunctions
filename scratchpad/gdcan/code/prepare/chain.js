// GD Cancel V2 - PREPARE chain. GOODS_DELIVERY's cancel (saveAs "Cancelled", pageStatus "Edit", the stored GD Created: the GD
// list's bulk Cancel) and GD_UNUSED_FN_NEW's planner, run in-process on the lifted deployed bodies (gdc lift/runtime.js,
// lift/lifted_prepare.js: GOODS_DELIVERY v245, GD_UNUSED_FN_NEW v55). The control flow is the deployed if-nodes' for this
// path (ids in comments); a branch V2 does not take ends the chain as NOT_ELIGIBLE. Needs gdc's prepare/chain.js (gcGdWrite,
// gcAfterImage). IN.params = gxParams(...); IN.reads = gcAdapt(...); IN.gatesOnly stops after GOODS_DELIVERY's gates.
const gxChain = function gxChain(IN) {
  const R = IN.reads;
  const out = { route: "PLANNED", code: "200", message: "", ran: [] };
  const run = (id) => {
    const o = __run(id);
    out.ran.push(id);
    return o;
  };
  const read = (id, value) => __set("node:" + id, { data: value });
  const stop = (code, message) => Object.assign(out, { route: code === "NOT_ELIGIBLE" ? "NOT_ELIGIBLE" : "STOP", code: code, message: message || "" });
  const num = (v) => Number(v || 0);
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const P = IN.params;

  const head = { "system:tenantId": IN.tenantId, "system:uuid": IN.uuid };
  for (const k of Object.keys(P)) if (P[k] !== null && P[k] !== undefined) head["workflowparams:" + k] = P[k];
  out.ctx = { head: head, callee: {} };

  const chain = () => {
    // if_gr_gate_completed: Completed / Created only
    run("code_node_eOO3RTkR");
    // if_H2b1nRMW skips a Cancelled save
    run("code_node_shTWK0Nm");
    read("get_node_iFPuvJX2", R.pickingSetup);
    read("sql_node_ItemFlags", R.itemFlags);
    read("get_packing_setup", R.packingSetup);
    run("code_picking_defaults");
    // if_WDczQjqt: no auto allocation for a Cancelled save
    // if_kpeBjx1k (the stored GD is Created): get_node_xTRvHWB8 + its Picking; if_amlgRu7I returns for saveAs Created only
    read("get_node_xTRvHWB8", R.gd);
    read("get_pick_for_reconcile", { count: 0, data: {} });
    // if_j38KWlWo: saveAs Created only
    const fill = run("code_node_IyJHrBst");
    // if_vnwLSl9x: a Completed / Cancelled GD, a Picking in the way (the fill-back's own refusals)
    if (num(fill.invalidData) === 1) return stop("400", fill.invalidDataMessage);
    const rec = run("code_pick_reconcile");
    if (num(rec.blockCreatedEdit) === 1 || num(rec.hasReversals) === 1) return stop("NOT_ELIGIBLE", "picking reconcile");
    run("code_node_EIDz5y7I");
    run("code_node_8pN1MyXz");
    // if_pIBgoMN3: a cancel never needs the credit limit (code_node_IyJHrBst: Completed, or Created with full_cl_check)
    if (s(fill.needCL) === "required") return stop("NOT_ELIGIBLE", "credit limit check on a cancel");
    // if_MIsS-gsS: Completed only. if_qAbmxB8R (!Draft):
    run("code_node_hb8ZWe9c");
    read("search_node_SOLine8kQ2", R.soLines);
    const qty = run("code_node_QtyCheckBatch");
    if (num(qty.itemNotFound) === 1) return stop("400", "Material not found or has been deleted");
    if (num(qty.soLineMissing) === 1) return stop("400", qty.soLineMissingMessage);
    // if_ACsN1GZD: a Cancelled save never stops on validationMessage
    const si = run("code_si_gate");
    if (num(si.siConfirm) === 412) return stop("NOT_ELIGIBLE", "auto Sales Invoice prompt on a cancel");
    if (IN.gatesOnly) {
      const eid = __v("node:code_node_EIDz5y7I.data") || {};
      out.route = "GATES";
      out.gates = { eidData: eid.data, eidFields: eid.required_fields };
      return out;
    }
    run("code_node_GKc0ALEe");
    // if_vm23aYTD (!Draft): workflow_node_PreflightChk01 = INVENTORY_BULK_APPLY PLAN here; FcGate: a Force Complete only;
    // if_ReorderCancelled -> REORDER_SET_REDIS GD_CANCELLED (COMMIT X6); if_yjDL1tIt (Edit) -> if_63JLcYAM (not Draft):
    // if_PkMergeGd (needMerge: a Picking save only), code_node_PkMerge, update_node_elLmtlLm, get_node_Cef6vdH4
    if (s(__v("node:code_node_8pN1MyXz.data.needMerge")) === "1") return stop("NOT_ELIGIBLE", "picking merge");
    const merge = run("code_node_PkMerge");
    out.write = gcGdWrite(__v("node:code_node_IyJHrBst.data.allData"), __v("node:code_node_GKc0ALEe.data.allData"), merge, P.saveAs);
    read("get_node_Cef6vdH4", { count: 1, data: gcAfterImage(R.gd.data, out.write, IN.kinds) });
    run("code_node_Pgtw6zFL");
    // if_5L-grvMH: Completed only
    if (num(fill.needSOCleanUp) === 1) return stop("NOT_ELIGIBLE", "lines removed from the delivery");
    read("get_cache_node_alhhxRsa", JSON.stringify(__v("node:code_node_QtyCheckBatch.data.updatedSOTable") || []));
    run("code_node_UMQapdjk");
    read("search_node_FVhsTRDu", R.soHeaders);
    run("code_node_lwB2FVe0");

    // workflow_node_hRMvSe8u -> GD_UNUSED_FN_NEW, its own context; parameters as the node's body_params map them
    const callee = {
      "system:tenantId": IN.tenantId,
      "system:uuid": IN.uuid,
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
    if (num(callee["workflowparams:isGDPP"]) === 1) return stop("NOT_ELIGIBLE", "GD from a Picking Plan");
    out.unused = __withContext(callee, () => {
      run("code_node_SSWylCan");
      read("sql_node_ItemDatas", R.itemDatas);
      read("search_node_r3NiR6B7", R.allocated);
      read("search_node_QdY1FLLA", R.pending);
      read("search_node_PpDelivRec01", { total: 0, count: 0, data: [] });
      run("code_node_eOMvMZOj");
      run("code_node_b71wypDJ");
      const exec = run("code_node_QrF4F4Hx");
      if (exec.code === "400") return { code: "400", message: exec.message };
      run("code_node_OBz5tEws");
      read("search_node_68C0TVzK", R.pickings);
      const pick = run("code_node_xVqrs3Yi");
      return { code: "200", exec: exec, pick: pick };
    });
    if (out.unused.code !== "200") return stop("400", out.unused.message || "GD_UNUSED_FN_NEW planner failed");
    // if_FcApply: Force Complete only; if_9xhwui06 (Auto Create Picking): saveAs Created only
    run("code_pick_hdr_sync");
    run("code_node_62FzZA2e");
    run("code_node_cv51vgiy");
    return out;
  };
  return __withContext(head, chain);
};

// GOODS_DELIVERY's request for a cancel of the stored GD: what the GD list's bulk Cancel sends (CancelWorkflow.js)
const gxParams = function gxParams(stored) {
  const allData = JSON.parse(JSON.stringify(stored));
  allData.gd_status = "Created";
  return { allData: allData, saveAs: "Cancelled", pageStatus: "Edit" };
};
