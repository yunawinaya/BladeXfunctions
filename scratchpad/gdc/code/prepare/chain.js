// GD Completion V2 - PREPARE chain. GOODS_DELIVERY's "Save as Completed" path (pageStatus Edit, stored status Created)
// and GD_UNUSED_FN_NEW's planner, run in-process on the lifted deployed bodies (lift/runtime.js). The control flow is
// the deployed if-nodes' for this path (ids in comments); a branch V2 does not take ends the chain as NOT_ELIGIBLE.
// IN.params = GOODS_DELIVERY's request (allData, saveAs, pageStatus, needCL, continueZero, auto_si_*, ...);
// IN.reads = adapted reads (code/prepare/adapter.js); IN.lenient lets a parity test skip nodes its recording lacks.
const gcChain = function gcChain(IN) {
  const R = IN.reads;
  const out = { route: "PLANNED", code: "200", message: "", ran: [] };
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

  const head = { "system:tenantId": IN.tenantId, "system:uuid": IN.uuid };
  for (const k of Object.keys(P)) if (P[k] !== null && P[k] !== undefined) head["workflowparams:" + k] = P[k];
  // the contexts outlive the run so the caller can read any node's output (__withContext(out.ctx.head, ...))
  out.ctx = { head: head, callee: {} };

  const chain = () => {
    // GR gate (if_gr_gate_completed): internal-trading linkage is NOT_ELIGIBLE (auto-GR prompts stay on the old path)
    run("code_gr_soids");
    read("search_gr_linkage", R.linkage);
    const link = run("code_gr_link");
    if (num(link.hasLink) === 1) return stop("NOT_ELIGIBLE", "internal-trading linkage (auto-GR)");
    run("code_gr_cover_ids");
    const grGate = run("code_gr_gate");
    if (num(grGate.grConfirm) !== 0 || num(grGate.doAutoGr) === 1) return stop("NOT_ELIGIBLE", "auto-GR");

    run("code_node_eOO3RTkR");
    const zero = run("code_node_shTWK0Nm");
    // if_H2b1nRMW
    if (num(zero.hasZero) === 1 && P.continueZero !== "Yes" && !P.isPicking) return stop("401", zero.message || "");

    read("get_node_iFPuvJX2", R.pickingSetup);
    read("sql_node_ItemFlags", R.itemFlags);
    read("get_packing_setup", R.packingSetup);
    const defaults = run("code_picking_defaults");
    // if_WDczQjqt: auto allocation of rows without one is NOT_ELIGIBLE
    if (defaults.pickingMode === "Auto" && !P.isPicking) {
      const prep = run("code_node_kJx9p9Nh");
      if (num(prep.totalRowsToAllocate) > 0) return stop("NOT_ELIGIBLE", "lines without an allocation");
      run("code_node_ymugKpln");
    }

    // if_kpeBjx1k (runs for Completed); its Picking read only matters to Created saves (reconcile, header sync)
    read("get_node_xTRvHWB8", R.gd);
    read("get_pick_for_reconcile", { count: 0, data: {} });
    const fill = run("code_node_IyJHrBst");
    // if_vnwLSl9x
    if (num(fill.invalidData) === 1) return stop("400", fill.invalidDataMessage);
    const rec = run("code_pick_reconcile");
    if (num(rec.blockCreatedEdit) === 1 || num(rec.hasReversals) === 1) return stop("NOT_ELIGIBLE", "picking reconcile");
    run("code_node_EIDz5y7I");
    run("code_node_8pN1MyXz");

    // if_qAbmxB8R (!Draft)
    run("code_node_hb8ZWe9c");
    read("search_node_SOLine8kQ2", R.soLines);
    const qty = run("code_node_QtyCheckBatch");
    if (!IN.gatesOnly) {
      if (num(qty.itemNotFound) === 1) return stop("400", "Material not found or has been deleted");
      if (num(qty.soLineMissing) === 1) return stop("400", qty.soLineMissingMessage);
      if (qty.validationMessage) return stop("400", qty.validationMessage);
    }
    const si = run("code_si_gate");
    // GD_COMPLETE_SUBMIT: the gates after CHECK_REQUIRED_FIELD and CREDIT_LIMIT_CHECK (sub-workflows) are reported, not
    // applied here, so the caller keeps GOODS_DELIVERY's order: required fields, 402/403, 405/406/407, 400, 412
    if (IN.gatesOnly) {
      const eid = __v("node:code_node_EIDz5y7I.data") || {};
      const all = __v("node:code_node_IyJHrBst.data.allData") || {};
      out.route = "GATES";
      out.gates = {
        eidData: eid.data, eidFields: eid.required_fields,
        needCL: s(fill.needCL), clAutoOverride: s(fill.clAutoOverride), customer: all.customer_name === undefined ? null : all.customer_name, total: all.gd_total === undefined ? null : all.gd_total,
        pickingRequired: num(defaults.pickingRequired), skipPicking: num(grGate.skipPicking), fillPickingStatus: fill.picking_status === undefined ? null : fill.picking_status,
        rollupPickingStatus: s(__v("node:code_node_8pN1MyXz.data.picking_status")), packingSetups: num((R.packingSetup || {}).count), packingStatus: s(fill.packing_status),
        itemNotFound: num(qty.itemNotFound), soLineMissing: num(qty.soLineMissing), soLineMissingMessage: s(qty.soLineMissingMessage), validationMessage: s(qty.validationMessage),
        siConfirm: num(si.siConfirm), siMsg: s(si.msg), doAutoSi: num(si.doAutoSi), needSOCleanUp: num(fill.needSOCleanUp),
      };
      return out;
    }
    if (num(si.siConfirm) === 412) return stop("412", si.msg || "");
    run("code_node_GKc0ALEe");
    // (a recording older than code_node_PkMerge wrote code_node_GKc0ALEe's lines and code_node_8pN1MyXz's status)
    const merge = IN.lenient && !__N["code_node_PkMerge"]
      ? { table_gd: __v("node:code_node_GKc0ALEe.data.allData.table_gd"), picking_status: __v("node:code_node_8pN1MyXz.data.picking_status") }
      : run("code_node_PkMerge");

    // update_node_elLmtlLm writes the GD; get_node_Cef6vdH4 reads it back
    out.write = gcGdWrite(__v("node:code_node_IyJHrBst.data.allData"), __v("node:code_node_GKc0ALEe.data.allData"), merge, P.saveAs);
    read("get_node_Cef6vdH4", { count: 1, data: gcAfterImage(R.gd.data, out.write, IN.kinds) });
    const gdd = run("code_node_Pgtw6zFL");
    if (num(fill.needSOCleanUp) === 1) return stop("NOT_ELIGIBLE", "lines removed from the delivery");

    // set_cache_node_Kij5KaiV -> get_cache_node_alhhxRsa (the cache holds the JSON text)
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
      // only read for a Picking Plan delivery (b71wypDJ consults it when isGDPP = 1)
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

    run("code_pick_hdr_sync");
    run("code_node_62FzZA2e");
    run("code_node_cv51vgiy");
    if (num(si.doAutoSi) === 1) run("code_si_trigger_prep");
    return out;
  };
  return __withContext(head, chain);
};

// GOODS_DELIVERY's request for a completion of the stored GD, as SUBMIT and PREPARE both build it. The headless sources send
// what their old-path callers send (PICKING: isPicking "Yes"; PACKING: isPacking 1); line overrides carry the form's own
// recomputed gd_undelivered_qty (the GD form's Edit mount), which the old path writes from the form.
const gcParams = function gcParams(stored, answers, source, overrides) {
  const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const a = answers || {};
  const allData = JSON.parse(JSON.stringify(stored));
  allData.gd_status = "Created";
  const o = overrides || {};
  for (const r of (allData.table_gd || []).flatMap((x) => [x].concat(Array.isArray(x.children) ? x.children : []))) {
    if (o[String(r.id)]) Object.assign(r, o[String(r.id)]);
  }
  const p = {
    allData: allData, saveAs: "Completed", pageStatus: "Edit", needCL: s(a.needCL) || "required", isForceComplete: "", continueZero: s(a.continueZero),
    auto_gr_confirmed: "", auto_gr_skip: "", auto_si_confirmed: s(a.auto_si_confirmed), auto_si_skip: s(a.auto_si_skip),
  };
  if (s(source) === "PICKING") p.isPicking = "Yes";
  if (s(source) === "PACKING") p.isPacking = 1;
  return p;
};

// update_node_elLmtlLm: 111 header columns from fillback allData (delivery_cost <- driver_cost, as deployed), gd_status =
// saveAs, gd_total from code_node_GKc0ALEe, picking_status + table_gd from code_node_PkMerge.
const GC_GD_WRITE_COLS = ["plant_id", "customer_name", "currency_code", "so_no", "pp_no", "so_id", "gd_billing_address", "gd_shipping_address", "gd_contact_name", "contact_number", "email_address", "gd_delivery_method", "delivery_date", "document_description", "assigned_to", "organization_id", "gd_created_by", "acc_integration_type", "reference_type", "gd_ref_doc", "last_sync_date", "customer_credit_limit", "overdue_limit", "outstanding_balance", "overdue_inv_total_amount", "is_accurate", "driver_name", "ic_no", "driver_contact_no", "vehicle_no", "pickup_date", "validity_of_collection", "courier_company", "shipping_date", "freight_charges", "tracking_number", "est_arrival_date", "est_delivery_date", "shipping_company", "shipping_method", "tpt_vehicle_number", "tpt_transport_name", "tpt_ic_no", "tpt_driver_contact_no", "select_vehicle_id", "gd_vehicle_type", "gd_vehicle_capacity", "gd_vehicle_cap_uom", "select_driver_id", "gd_driver_contact", "gd_driver_ic", "order_tnc", "order_payment_details", "order_delivery_term", "order_remark", "order_remark2", "order_remark3", "order_remark4", "order_remark5", "billing_address_name", "billing_address_phone", "billing_address_line_1", "billing_address_line_2", "billing_address_line_3", "billing_address_line_4", "billing_address_city", "billing_postal_code", "billing_address_state", "billing_address_country", "billing_attention", "billing_address_fax", "billing_address_code", "shipping_address_code", "shipping_address_fax", "shipping_address_name", "shipping_address_phone", "shipping_address_line_1", "shipping_address_line_2", "shipping_address_line_3", "shipping_address_line_4", "shipping_address_city", "shipping_postal_code", "shipping_address_state", "shipping_address_country", "shipping_attention", "to_no", "pp_id", "is_select_picking", "sp_vehicle_no", "gd_area_id", "tpt_driver_name", "di_shipping_method", "di_driver_name", "di_ic_no", "di_driver_contact_no", "di_shipping_company", "di_transport_name", "di_vehicle_number", "di_est_delivery_date", "di_est_arrival_date", "di_pickup_date", "di_validity_of_collection", "di_tracking_number", "di_freight_charges", "project_id", "sales_person", "delivery_no"];

const gcGdWrite = function gcGdWrite(fillAll, fmtAll, merge, saveAs) {
  const header = {};
  for (const c of GC_GD_WRITE_COLS) header[c] = fillAll[c] === undefined ? null : fillAll[c];
  header.delivery_cost = fillAll.driver_cost === undefined ? null : fillAll.driver_cost;
  header.gd_status = saveAs;
  header.gd_total = fmtAll.gd_total === undefined ? null : fmtAll.gd_total;
  header.picking_status = merge.picking_status === undefined ? null : merge.picking_status;
  return { header: header, table_gd: merge.table_gd || [] };
};

// get_node_Cef6vdH4's view of the GD after the write: the stored GD with the written columns replaced and the written
// lines, as the DB returns them: each value in its column's type (a datetime as YYYY-MM-DD HH:MM:SS, numbers as numbers,
// text as text), null / "" keys absent, nested rows keep parent_id. kinds = { header, line }: column -> [kind, physical].
const gcColValue = function gcColValue(v, kind) {
  if (v === null || v === undefined || v === "") return undefined;
  const k = kind ? kind[0] : null;
  if (k === "dt") {
    const m = String(v).match(/^(\d{4}-\d\d-\d\d)(?:[T ](\d\d:\d\d:\d\d))?/);
    return m ? m[1] + " " + (m[2] || "00:00:00") : v;
  }
  if (k === "dec" || k === "int") return typeof v === "number" ? v : Number(v);
  // a bigint (or a text column the schema types as one) reads back as a number up to 15 digits, else as exact text
  if (k === "id" || k === "num") return typeof v === "number" ? v : /^-?[0-9]{1,15}$/.test(String(v)) ? Number(v) : String(v);
  if (k === "str") return typeof v === "object" ? JSON.stringify(v) : String(v);
  return v;
};
const gcAfterImage = function gcAfterImage(stored, write, kinds) {
  const H = (kinds && kinds.header) || {};
  const L = (kinds && kinds.line) || {};
  const row = (r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      // only columns are stored (a form row's fm_key and the like are not)
      if (k === "children" || !L[k]) continue;
      const c = gcColValue(v, L[k]);
      if (c !== undefined) o[k] = c;
    }
    if (Array.isArray(r.children)) o.children = r.children.map(row);
    return o;
  };
  const gd = JSON.parse(JSON.stringify(stored));
  for (const [c, v] of Object.entries(write.header)) {
    if (!H[c]) continue;
    const x = gcColValue(v, H[c]);
    if (x === undefined) delete gd[c];
    else gd[c] = x;
  }
  gd.table_gd = (write.table_gd || []).map(row);
  return gd;
};
