// GR Completion V2 - PREPARE chain: GOODS_RECEIVING's "Save as Completed" path (dev v100 = prod v99 + guards), run
// in-process on the lifted deployed bodies (lift/runtime.js). The control flow is the deployed if-nodes' (ids in comments);
// the classic's writes become in-memory state the next node reads (the PO line a later row re-reads, the on-order row,
// the batch a later row finds, the redis caches); a branch V2 does not take ends the chain as NOT_ELIGIBLE.
//
// IN = { params: GOODS_RECEIVING's request { allData, saveAs, pageStatus, continueZero, skip_putaway },
//        reads: {
//          putawaySetup, items, poDocs (get_node_QBrFrLs9 / search_node_BwcLu7r7 / search_node_nkWkBdXY shapes),
//          origGR      search_origGRMain's answer (Edit): the GR as stored before this save,
//          readBack    (allData, appliedTableGr, saveAs) -> the GR as get_node_UeM3HpzR / add_node_nGMSu41b answer after
//                      the write (update_node_a31whzYI: gr_status = saveAs, table_gr = code_node_ApplyBatches'),
//          loadingBay  get_node_njg7cSUu's answer, putawayRule  get_node_xUdzlNqh's answer,
//          poLines     PO lines (any order) as get_node_T0BtCHSS answers one, poHeaders  PO headers (get_node_SnZKYhVp),
//          onOrder     on_order_purchase_order rows, batches  live batch rows by number (search_existing_batch order),
//          items for ADD_INVENTORY: the same search_node_BwcLu7r7 rows },
//        batchNumbers: (requests) -> [{ ok, batch_number, message }]   the GENERATE_BATCH calls, in loop order,
//        numberedInCommit: the numbers are C1's (PREPARE previews them): an auto-numbered row looks up no batch,
//        origReserved: SUBMIT's { <po_line_item_id>: qty } (replaces code_node_origReserved's answer),
//        tenantId, uuid, gatesOnly, lenient (a recorded run may lack a node) }
// -> { route: PLANNED | STOP | NOT_ELIGIBLE | GATES, code, message, ran, ctx, ... } (grChain) and the per-row trace
//    plan.js turns into the manifest.
const GR_BATCH_REF = "BATCHREF:";

// ADD_INVENTORY (v65) for one GRN row, as INVENTORY_BULK_APPLY's ADD branch prices it (scratchpad/gdc/engine/core.js:
// UOM, then FIFO / WA cost from the PO line's amount, Fixed Cost from the item, else the line's unit price) - the price
// the classic's putaway lines took from the add's answer. stock_control 0: 401, nothing priced.
const grGrnPrice = function grGrnPrice(item, m) {
  const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
  const FIFO = "First In First Out";
  const WA = "Weighted Average";
  const FIXED = "Fixed Cost";
  const altQty = q8(parseFloat(m.quantity));
  let baseQty = altQty;
  const altUOM = m.material_uom || item.based_uom;
  const conv = Array.isArray(item.table_uom_conversion) && item.table_uom_conversion.length > 0 ? item.table_uom_conversion.find((c) => c.alt_uom_id === altUOM) : null;
  if (conv) baseQty = q8(altQty * conv.base_qty);
  const method = item.material_costing_method;
  const trx = m.transaction_type;
  let unitPrice = m.unit_price;
  let totalPrice = unitPrice * baseQty;
  let costPrice = null;
  let fixedPrice = null;
  if (trx !== undefined && trx !== null && trx !== "LOT") {
    if (method === FIFO || method === WA) {
      let up = q8(m.unit_price);
      let tp = q8(up * baseQty);
      if (trx === "GRN") {
        const poQ = q8(parseFloat(m.po_quantity) || 0);
        const amt = q8(parseFloat(m.po_amount) || 0);
        const conversion = q8(baseQty / parseFloat(m.quantity));
        const rate = m.exchange_rate || 1;
        const ppu = poQ > 0 ? q8(amt / poQ) : 0;
        up = q8((ppu / conversion) * rate);
        tp = q8(up * baseQty);
      }
      costPrice = { up, tp };
    } else {
      const up = q8(item.purchase_unit_price);
      fixedPrice = { up, tp: q8(up * baseQty) };
    }
  }
  if (trx !== "LOT") {
    if (method === FIFO || method === WA) {
      unitPrice = costPrice ? costPrice.up : undefined;
      totalPrice = costPrice ? costPrice.tp : undefined;
    } else if (method === FIXED) {
      unitPrice = fixedPrice ? fixedPrice.up : undefined;
      totalPrice = fixedPrice ? fixedPrice.tp : undefined;
    }
  }
  return { unitPrice: q8(unitPrice), totalPrice: q8(totalPrice), baseQty: baseQty, altQty: altQty, method: method };
};

const grChain = function grChain(IN) {
  const R = IN.reads || {};
  const P = IN.params || {};
  const out = { route: "PLANNED", code: "200", message: "", ran: [], rows: [], batchCalls: [], createdBatches: [] };
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
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const getShape = (row) => (row ? { count: 1, data: clone(row) } : { count: 0, data: {} });
  // A loop body re-reads the whole GR, every item and the redis arrays the loop grows: as in the classic, O(N^2) at
  // 2,000 lines. Each per-row body gets, for the call, a view holding exactly what it reads (a token resolves to a fresh
  // copy, so the view is what a body sees); the arrays the loop grows are fed empty and their one new entry appended.
  const withView = (overrides, fn) => {
    const saved = {};
    for (const k of Object.keys(overrides)) {
      saved[k] = Object.prototype.hasOwnProperty.call(__CTX, k) ? { v: __CTX[k] } : null;
      __CTX[k] = overrides[k];
    }
    try {
      return fn();
    } finally {
      for (const k of Object.keys(saved)) {
        if (saved[k]) __CTX[k] = saved[k].v;
        else delete __CTX[k];
      }
    }
  };

  const head = { "system:tenantId": IN.tenantId, "system:uuid": IN.uuid };
  for (const k of Object.keys(P)) if (P[k] !== null && P[k] !== undefined) head["workflowparams:" + k] = P[k];
  out.ctx = head;

  const chain = () => {
    const zero = run("code_node_mlTvKeIR");
    // if_cJ2OjlaO: hasZero == 1 && continueZero != "Yes" && saveAs != "Cancelled"
    if (num(zero.hasZero) === 1 && s(P.continueZero) !== "Yes" && s(P.saveAs) !== "Cancelled") return stop("401", zero.message);
    read("get_node_QBrFrLs9", R.putawaySetup || { count: 0, data: {} });
    const fill = run("code_node_4r2Fv9G5");
    // if_6-TdgnOI: invalidMessage is not null
    if (fill.invalidMessage !== undefined && fill.invalidMessage !== null) return stop("400", fill.invalidMessage);
    const reqd = run("code_node_wMQADp4i");
    // workflow_node_MiB8SGwF -> CHECK_REQUIRED_FIELD (v8): its one code node, in its own context
    const chk = __withContext({ "system:tenantId": IN.tenantId, "workflowparams:entry": reqd.data, "workflowparams:required_fields": reqd.required_fields },
      () => (IN.lenient && !__N.code_node_AeSdXE85 ? {} : __run("code_node_AeSdXE85")));
    read("workflow_node_MiB8SGwF", { data: chk });
    // if_KUYm3VhI
    if (s(chk.status) === "Failed") return stop("400", chk.message);
    // if_qf0otSN3: saveAs != Draft
    if (s(P.saveAs) !== "Draft") {
      run("code_node_QB3GUnrS");
      read("search_node_BwcLu7r7", R.items || { total: 0, count: 0, data: [] });
      const loc = run("code_node_Ga3BZDyy");
      if (num(loc.locationFailed) === 1) return stop("400", loc.locationMessage);
      if (num(loc.categoryFailed) === 1) return stop("400", loc.categoryMessage);
      // if_58izl9J1: saveAs == Completed
      if (s(P.saveAs) === "Completed") {
        read("search_node_nkWkBdXY", R.poDocs || { total: 0, count: 0, data: [] });
        const val = run("code_node_e9pINRwN");
        if (num(val.hasErrors) === 1) return stop("400", val.errorMessage);
      }
    }
    if (IN.gatesOnly) {
      out.route = "GATES";
      return out;
    }
    // if_origReserved: pageStatus == Edit
    if (s(P.pageStatus) === "Edit") read("search_origGRMain", R.origGR || { total: 0, count: 0, data: [] });
    run("code_node_origReserved");
    // V2: SUBMIT hands the reservation it saw before it locked the GR (a Created GR's own lines)
    if (IN.origReserved && typeof IN.origReserved === "object") read("code_node_origReserved", { origReserved: clone(IN.origReserved) });
    // if_A28AB0eJ: saveAs != Draft (a Draft save writes the GR and ends; V2 only completes)
    if (s(P.saveAs) === "Draft") return stop("NOT_ELIGIBLE", "a Draft save");

    // loop_BatchGen over loopRows: GENERATE_BATCH once per auto-numbered row that is not a hierarchy child, in order
    const loopRows = __v("node:code_node_4r2Fv9G5.data.loopRows") || [];
    const allData = __v("node:code_node_4r2Fv9G5.data.allData") || {};
    const calls = [];
    for (let i = 0; i < loopRows.length; i++) {
      read("get_cache_node_BGIDXget", String(i));
      // code_node_BatchGenPrep reads allData.gr_date and loopRows[index]
      const rowAt = {};
      rowAt[i] = loopRows[i];
      const prep = withView({ "node:code_node_4r2Fv9G5": { data: { allData: { gr_date: allData.gr_date }, loopRows: rowAt } } }, () => run("code_node_BatchGenPrep"));
      if (num(prep.needsGen) === 1) {
        // workflow_node_GenBatch's body params (a null value is not sent)
        const req = { item_id: prep.item_id, document_date: prep.document_date, expired_date: prep.expired_date, manufacturing_date: prep.manufacturing_date, organization_id: allData.organization_id };
        for (const k of Object.keys(req)) if (req[k] === undefined || req[k] === null) delete req[k];
        calls.push({ index: Number(prep.index), request: req });
      }
    }
    out.batchCalls = calls;
    const autoIdx = {};
    for (const c of calls) autoIdx[c.index] = true;
    const numbers = calls.length ? IN.batchNumbers(calls.map((c) => c.request)) : [];
    const generated = [];
    for (let k = 0; k < calls.length; k++) {
      const n = numbers[k] || {};
      // a GENERATE_BATCH error end node fails the whole GOODS_RECEIVING run (its message surfaces); nothing past it runs
      if (!n.ok) return stop("BATCH", n.message || "Failed to generate batch number.");
      read("workflow_node_GenBatch", { batch_number: n.batch_number });
      read("code_node_BatchGenPrep", { index: calls[k].index });
      run("code_node_NormalizeBatch");
      read("get_cache_node_BGARRget", "[]");
      const app = run("code_node_AppendBatch");
      for (const g of app.generatedBatches || []) generated.push(g);
    }
    read("get_cache_node_BGARRfinal", JSON.stringify(generated));
    const applied = run("code_node_ApplyBatches");
    const saveAs = s(__v("node:code_node_4r2Fv9G5.data.saveAs"));
    // the GR write and its read-back (Edit: update_node_a31whzYI + get_node_UeM3HpzR; Add: add_node_nGMSu41b)
    const stored = IN.reads.readBack(allData, applied.table_gr || [], saveAs);
    if (s(P.pageStatus) === "Add") read("add_node_nGMSu41b", [stored]);
    else read("get_node_UeM3HpzR", { count: stored ? 1 : 0, data: stored || {} });
    out.saveAs = saveAs;
    out.stored = stored;

    // if_7eKOPdic: putaway_required == 1 && is_loading_bay == 1 && default_loading_bay is null
    const ps = (R.putawaySetup && R.putawaySetup.data) || {};
    const lbayNull = ps.default_loading_bay === undefined || ps.default_loading_bay === null;
    if (num(ps.putaway_required) === 1 && num(ps.is_loading_bay) === 1 && lbayNull) read("get_node_njg7cSUu", R.loadingBay || { count: 0, data: {} });

    // the classic's writes, kept in memory for the rows after them
    const poLines = {};
    for (const l of R.poLines || []) poLines[s(l.id)] = clone(l);
    const poHeaders = {};
    for (const h of R.poHeaders || []) poHeaders[s(h.id)] = clone(h);
    const onOrder = {};
    for (const o of (R.onOrder || []).slice().sort((a, b) => (s(a.id).length - s(b.id).length) || (s(a.id) < s(b.id) ? -1 : 1))) (onOrder[s(o.po_line_id)] = onOrder[s(o.po_line_id)] || []).push(clone(o));
    const batches = (R.batches || []).map(clone);
    const caches = {};
    const skipPutaway = num(__v("node:code_node_4r2Fv9G5.data.skipPutaway"));
    let refSeq = 0;

    // loop_QYRlFFAo over loopRows. code_node_D9IbUV8t reads the stored GR's plant_id, organization_id, gr_no, gr_date,
    // its flat row [index], and - for isFirstReservationRow - parent_or_child + po_line_item_id of the rows on the same PO
    // line (a row on another line is {} to it: no po_line_item_id never matches); of the items only the row's own. The
    // tree keeps its shape (a bundle row keeps its children's count) so flat positions are the classic's.
    const topRows = stored && Array.isArray(stored.table_gr) ? stored.table_gr : [];
    const flatAt = [];
    const blanks = topRows.map((r, t) => {
      flatAt.push({ top: t, child: -1 });
      if (!Array.isArray(r.children)) return {};
      return { children: r.children.map((c, k) => { flatAt.push({ top: t, child: k }); return {}; }) };
    });
    const storedFlat = topRows.flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
    const byLine = {};
    storedFlat.forEach((r, p) => { if (r && r.po_line_item_id) (byLine[r.po_line_item_id] = byLine[r.po_line_item_id] || []).push(p); });
    const scanRow = (r) => ({ parent_or_child: r.parent_or_child, po_line_item_id: r.po_line_item_id });
    const viewFor = (i) => {
      const tree = blanks.slice();
      const put = (p, row) => {
        const at = flatAt[p];
        if (!at) return;
        if (at.child < 0) tree[at.top] = Object.assign({}, row, tree[at.top].children ? { children: tree[at.top].children } : {});
        else {
          const parent = Object.assign({}, tree[at.top]);
          parent.children = parent.children.slice();
          parent.children[at.child] = row;
          tree[at.top] = parent;
        }
      };
      const self = storedFlat[i];
      for (const p of (self && self.po_line_item_id ? byLine[self.po_line_item_id] : []) || []) if (p !== i) put(p, scanRow(storedFlat[p]));
      if (self) put(i, self);
      return { plant_id: stored.plant_id, organization_id: stored.organization_id, gr_no: stored.gr_no, gr_date: stored.gr_date, table_gr: tree };
    };
    const itemList = ((R.items && R.items.data) || []);
    const origMap = __v("node:code_node_origReserved.data.origReserved") || {};
    const putawayAcc = [];
    const itAcc = [];
    for (let i = 0; i < loopRows.length; i++) {
      read("get_cache_node_5vPHf6xv", String(i));
      const mat = storedFlat[i] ? storedFlat[i].item_id : undefined;
      const own = itemList.filter((it) => it.id === mat);
      const view = stored ? viewFor(i) : {};
      const grView = s(P.pageStatus) === "Add" ? { "node:add_node_nGMSu41b": { data: [view] } } : { "node:get_node_UeM3HpzR": { data: { count: 1, data: view } } };
      const d = withView(Object.assign(grView, { "node:search_node_BwcLu7r7": { data: { total: own.length, count: own.length, data: own } } }), () => run("code_node_D9IbUV8t"));
      // grData (the GR view) is read only by code_node_BSBUmUSx, an inspection-lot node V2 never reaches
      const trace = { index: i, line_id: s((d.grItem || {}).id), d: Object.assign({}, d, { grData: undefined }) };
      out.rows.push(trace);
      const pidx = s(d.parent_index);
      // if_g_createsBatch / if_9IJsWcHK: a hierarchy split parent creates the batch its children receive into
      if (num(d.createsBatch) === 1 && s(d.batch_no) !== "-") {
        const ref = GR_BATCH_REF + "S" + ++refSeq;
        out.createdBatches.push({ ref: ref, by: "split-parent", index: i, batch_number: d.batch_no, material_id: d.material_id, quantity: d.quantity, row: trace });
        batches.unshift({ id: ref, batch_number: d.batch_no, material_id: d.material_id, plant_id: d.plant_id, organization_id: d.organization_id });
        read("add_node_WRixae5d", [{ id: ref }]);
        const b = run("code_node_qtCEVR5x");
        caches["batch_id_" + pidx] = s(b.batchId);
      }
      // if_g_updatesPO: updatesPOLine == 1 -> get_node_SnZKYhVp + get_node_T0BtCHSS -> code_node_H4Eg0oEI -> update_node_3czB3UP1
      if (num(d.updatesPOLine) === 1) {
        read("get_node_SnZKYhVp", getShape(poHeaders[s(d.po_id)]));
        const before = poLines[s(d.po_line_id)];
        read("get_node_T0BtCHSS", getShape(before));
        // code_node_H4Eg0oEI reads origReserved[its PO line] only
        const oneLine = {};
        if (Object.prototype.hasOwnProperty.call(origMap, s(d.po_line_id))) oneLine[s(d.po_line_id)] = origMap[s(d.po_line_id)];
        const h = withView({ "node:code_node_origReserved": { data: { origReserved: oneLine } } }, () => run("code_node_H4Eg0oEI"));
        trace.po = { before: clone(before) || null, after: h };
        // if_g_spCache: a split parent caches its PO figures for its children (set_cache_node_RBB8V5Ft)
        if (num(d.isSplitParent) === 1) caches["po_data_" + pidx] = JSON.stringify(h);
        if (before) {
          before.received_qty = h.newReceivedQty;
          before.outstanding_quantity = h.newOutstandingQty;
          before.line_status = h.lineStatus;
          before.created_received_qty = h.newCreatedReceivedQty;
        }
      }
      // if_g_updatesOO: updatesOnOrder == 1 -> get_node_K8mPq3Rt (first row) -> code_node_W4nXz7Yb -> every row of the PO line
      if (num(d.updatesOnOrder) === 1) {
        const rows = onOrder[s(d.po_line_id)] || [];
        read("get_node_K8mPq3Rt", getShape(rows[0]));
        const w = run("code_node_W4nXz7Yb");
        trace.oo = { rows: rows.length, after: w };
        for (const r of rows) {
          r.open_qty = w.updatedOpenQty;
          r.received_qty = w.updatedReceivedQty;
        }
      }
      // if_g_addsInventory
      if (num(d.addsInventory) === 1) {
        if (num(d.isChild) === 1) {
          read("get_cache_node_tMiO2epL", caches["batch_id_" + pidx] === undefined ? null : caches["batch_id_" + pidx]);
          read("get_cache_node_pkIaRLdL", caches["po_data_" + pidx] === undefined ? null : caches["po_data_" + pidx]);
        }
        // if_needs_batch_lookup: batch_no != "-" && isChild == 0 -> search_existing_batch (limit 1)
        if (s(d.batch_no) !== "-" && num(d.isChild) === 0) {
          // MySQL utf8mb4_general_ci equality: case-insensitive, trailing spaces ignored. A generated number cannot match
          // a batch that existed before the run (GENERATE_BATCH refused any), only one an earlier row of this run made
          // with the same number - which only C1 knows, so an auto-numbered row looks nothing up here (C1 merges)
          const ci = (v) => s(v).replace(/ +$/, "").toLowerCase();
          const hit = IN.numberedInCommit && autoIdx[i] ? null : batches.find((b) => ci(b.batch_number) === ci(d.batch_no) && s(b.material_id) === s(d.material_id) &&
            s(b.organization_id) === s(d.organization_id) && s(b.plant_id) === s(d.plant_id));
          read("search_existing_batch", { total: hit ? 1 : 0, count: hit ? 1 : 0, data: hit ? [clone(hit)] : [] });
        }
        const ip = run("code_node_ip8w2l8k");
        const hu = run("code_node_hRG2RgIm");
        // workflow_node_bThL52BP: ADD_INVENTORY's body params (a null value is not sent)
        const mv = {
          plant_id: d.plant_id, organization_id: d.organization_id, material_id: d.material_id, quantity: d.quantity, material_uom: d.material_uom,
          transaction_type: "GRN", trx_no: d.gr_no, inventory_category: d.inventory_category, location_id: d.location_id, batch_id: ip.batchId,
          batch_number: ip.batchNumber, doc_date: d.doc_date, manufacturing_date: d.manufacturing_date, expired_date: d.expired_date,
          remark: d.remark, remark2: d.remark2, remark3: d.remark3, index: d.index, unit_price: d.unit_price, parent_trx_no: d.po_no,
          po_quantity: ip.poQty, po_amount: ip.poAmount, exchange_rate: ip.exchangeRate, isMovingInv: 0, handling_unit_id: hu.handling_unit_id,
        };
        for (const k of Object.keys(mv)) if (mv[k] === undefined || mv[k] === null) delete mv[k];
        trace.movement = mv;
        // ADD_INVENTORY's answer: if_V69BpQrL validation, the item (itemData, else by id + organization), stock control, price, batch
        const item = d.itemData || null;
        let res;
        if (!s(mv.material_id) || mv.quantity === undefined || !(Number(mv.quantity) > 0) || !s(mv.plant_id) || !s(mv.organization_id)) {
          res = { errorMessage: "Validation Failed", code: "400" };
        } else if (!item) {
          // itemData is search_node_BwcLu7r7's row; without it ADD_INVENTORY re-reads the item by id + organization
          res = { code: "400", errorMessage: "Item or material not found" };
        } else if (num(item.stock_control) === 0) {
          res = { code: "401", errorMessage: "Skipping inventory update for item (stock control = 0)" };
        } else {
          const pr = grGrnPrice(item, mv);
          let batchId = mv.batch_id || null;
          if (mv.batch_number !== "-" && mv.batch_number && !mv.batch_id) {
            batchId = GR_BATCH_REF + "B" + ++refSeq;
            out.createdBatches.push({ ref: batchId, by: "add", index: i, batch_number: mv.batch_number, material_id: mv.material_id, base_qty: pr.baseQty, row: trace });
            batches.unshift({ id: batchId, batch_number: mv.batch_number, material_id: mv.material_id, plant_id: mv.plant_id, organization_id: mv.organization_id });
          }
          res = { code: "200", batchId: batchId, unitPrice: pr.unitPrice, totalPrice: pr.totalPrice };
          trace.price = pr;
        }
        trace.add = res;
        read("workflow_node_bThL52BP", res);
        // if_oSNxCRnU: code == '400' -> return_node_avFiHMGU, whose message (the add's data.message) is empty: the add answers
        // errorMessage. V2 reports the add's errorMessage.
        if (s(res.code) === "400") return stop("400", res.errorMessage || "");
        const hp = run("code_node_ngFX3hcL");
        // if_q01ggsd6: a handling unit (HANDLING_UNIT workflow) is not V2-eligible
        if (num(hp.hasHuData) === 1) return stop("NOT_ELIGIBLE", "handling units are received by the classic save");
        // if_BJ3q0dLh: an inspection lot is not V2-eligible
        if (num(d.receivingInspection) === 1 && s(d.inventory_category) === "Quality Inspection") return stop("NOT_ELIGIBLE", "receiving inspection lots are created by the classic save");
        // if_g8CWGJlk: putaway_required == 1 && auto_trigger_to == 1 && category != QI && skipPutaway == 0
        if (num(ps.putaway_required) === 1 && num(ps.auto_trigger_to) === 1 && s(d.inventory_category) !== "Quality Inspection" && skipPutaway === 0) {
          read("get_cache_node_QjOGmuJM", "[]");
          const pl = run("code_node_7kcbaray");
          for (const x of pl.putAwayLineItemData || []) putawayAcc.push(x);
          trace.putaway = true;
        }
        // if_ITstage: inventory_category == In Transit
        if (s(d.inventory_category) === "In Transit") {
          read("get_cache_node_ITget", "[]");
          const it = run("code_node_ITrow");
          for (const x of it.inTransitLineData || []) itAcc.push(x);
          trace.inTransit = true;
        }
      }
    }
    // search_node_XqqoMDRs: the GR's POs as the loop left them
    const poDocsAfter = ((R.poDocs && R.poDocs.data) || []).map((doc) => {
      const d2 = clone(doc);
      const fix = (rows) => (rows || []).map((r) => {
        const live = poLines[s(r.id)];
        const x = Object.assign({}, r, live ? { received_qty: live.received_qty, outstanding_quantity: live.outstanding_quantity, line_status: live.line_status, created_received_qty: live.created_received_qty } : {});
        if (Array.isArray(r.children)) x.children = fix(r.children);
        return x;
      });
      d2.table_po = fix(d2.table_po);
      return d2;
    });
    read("search_node_XqqoMDRs", { total: poDocsAfter.length, count: poDocsAfter.length, data: poDocsAfter });
    out.poStatus = run("code_node_KAeXsqwm");
    read("get_cache_node_d6mMkXQd", JSON.stringify(putawayAcc));
    read("get_cache_node_ITfinal", JSON.stringify(itAcc));
    const has = run("code_node_pdqxs8pN");
    run("code_node_UQWzCg37");
    read("get_node_ITgrLines", { count: stored ? 1 : 0, data: stored || {} });
    out.putawayStatus = null;
    // if_yBDvMDfH: auto_trigger_to == 1 && putaway_required == 1 && hasPutaway == 1
    if (num(ps.auto_trigger_to) === 1 && num(ps.putaway_required) === 1 && num(has.hasPutaway) === 1) {
      read("get_node_xUdzlNqh", R.putawayRule || { count: 0, data: {} });
      out.putaway = run("code_node_jo9g6Ldx").putawayData || null;
      // add_node_RTuMAGp5 makes the TO; COMMIT C4 makes it, so ITrows gets a placeholder it stamps as the target
      read("add_node_RTuMAGp5", [{ id: "TOREF", to_id: "TOREF" }]);
      out.putawayStatus = "Created";
    } else if (num(ps.putaway_required) === 1 && skipPutaway === 0) {
      // if_9HxJ3QVf -> update_node_AJkeXj0a
      out.putawayStatus = "Not Created";
    }
    out.inTransit = run("code_node_ITrows");
    out.itemDates = run("code_node_2Cq2eMRb");
    return out;
  };
  return __withContext(head, chain);
};

// SUBMIT's gates, in GOODS_RECEIVING's order with its codes and texts, on the FORM's data (saveAs Completed):
// code_node_mlTvKeIR (401, unless continueZero says go on), code_node_4r2Fv9G5 (400), CHECK_REQUIRED_FIELD (400),
// code_node_Ga3BZDyy (400), code_node_e9pINRwN (400). reads: { putawaySetup, items, poDocs } in the adapter's shapes.
// -> { route: "STOP", code, message } | { route: "GO", allData (what add_node_nGMSu41b / update_node_a31whzYI write,
//    gr_status = Completed | Received), gr_status, saveAs, loopRows, poIds, skipPutaway, putaway flags }
const grGates = function grGates(G) {
  const params = { allData: G.form, saveAs: "Completed", pageStatus: G.pageStatus || "Add", continueZero: G.continueZero || "" };
  if (G.skip_putaway !== undefined && G.skip_putaway !== null) params.skip_putaway = G.skip_putaway;
  const res = grChain({ params: params, reads: G.reads || {}, tenantId: G.tenantId, uuid: G.uuid || "GRS", gatesOnly: true });
  if (res.route !== "GATES") return { route: "STOP", code: res.code, message: res.message };
  return __withContext(res.ctx, () => {
    const fill = __v("node:code_node_4r2Fv9G5.data") || {};
    const allData = fill.allData || {};
    const ps = (G.reads && G.reads.putawaySetup && G.reads.putawaySetup.data) || {};
    // update_node_a31whzYI / add_node_nGMSu41b write gr_status = the fill-back's saveAs (Completed | Received)
    allData.gr_status = fill.saveAs;
    return {
      route: "GO", code: "200", message: "", allData: allData, gr_status: fill.saveAs, saveAs: fill.saveAs, loopRows: fill.loopRows || [],
      poIds: fill.poIds || [], skipPutaway: Number(fill.skipPutaway || 0),
      putawayRequired: Number(ps.putaway_required || 0), autoTriggerTo: Number(ps.auto_trigger_to || 0), isLoadingBay: Number(ps.is_loading_bay || 0),
    };
  });
};
