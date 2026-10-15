// Putaway Completion V2 - the classic Completed path (PUTAWAY_LOOP dev v16 Edit prep -> PUTAWAY dev v34) run in-process on
// the lifted deployed bodies (lift/runtime.js), and the confirmation contract that feeds it.
//
// The request's `lines` (per stored TO line id; a split names its parent line's id) + the stored TO rebuild the allData
// the desktop form sent the classic (pwRebuild). pwChain runs the lifted bodies in the deployed order (if-nodes by id in
// comments): PUTAWAY_LOOP kku8SAT9 / 0rV4kqmz + CHECK_REQUIRED_FIELD / pcHu3XnW / XZtMB79F, then PUTAWAY M7IX2sBi /
// S8GL6e4o / qfSZO0bi / KbJLkjP8 / M7XzDZ48 / ITmatch / ds7jurnq and per movement dofqVRSn (+ 4Baken82 on the IN). The
// classic's SUBTRACT_INVENTORY / ADD_INVENTORY calls become the parameter sets they would have been sent; the SUBTRACT's
// answer the ADD reads (its dates) is the source item_batch_balance row's, as code_node_DUBS9GZF answers it.
const PW_CATEGORIES = ["Unrestricted", "Reserved", "Blocked", "Quality Inspection", "In Transit"];
const PW_MAX_ROWS = 2500;
const PW_DIG = /^[0-9]{1,20}$/;
const PW_GUARD_500 = /^This putaway has \d+ lines\. Completing more than 500 lines at once is not supported here\.$/;

const pwStr = (v) => (v === undefined || v === null ? "" : String(v));
const pwNum = (v) => Number(v || 0);
const pwClone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const pwFlat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));

// Stored top-level lines that share a line_index: the lifted bodies key on line_index (S8GL6e4o's stored check,
// KbJLkjP8's per-line totals), so each such line runs under its own alias "<line_index>#<id>" and every output is mapped
// back. Lines with a unique line_index are untouched.
const pwAliases = function pwAliases(lines) {
  const count = {};
  for (const l of lines || []) count[pwStr(l.line_index)] = (count[pwStr(l.line_index)] || 0) + 1;
  const byId = {};
  for (const l of lines || []) if (count[pwStr(l.line_index)] > 1) byId[pwStr(l.id)] = pwStr(l.line_index) + "#" + pwStr(l.id);
  return byId;
};
const pwUnalias = (text, aliases) => {
  let t = pwStr(text);
  for (const id of Object.keys(aliases || {})) t = t.split(aliases[id]).join(aliases[id].slice(0, aliases[id].length - id.length - 1));
  return t;
};

// The request's confirmation -> rows per stored line. Each entry: { id | parent_id, qty, target_location, storage_location,
// target_inv_category, remark }; `id` = put the line away on one bin, `parent_id` = one row of a split of that line (in
// order). -> { ok, code, message, byLine: { <line id>: { split: bool, rows: [...] } }, count }
const pwRequestRows = function pwRequestRows(request, storedById) {
  const bad = (message) => ({ ok: false, code: "400", message: message, byLine: {}, count: 0 });
  const lines = request && Array.isArray(request.lines) ? request.lines : null;
  if (!lines || !lines.length) return bad("Cannot complete putaway. At least one item must have putaway quantity greater than 0.");
  const byLine = {};
  for (let i = 0; i < lines.length; i++) {
    const e = lines[i] || {};
    const at = "line " + (i + 1) + ": ";
    const own = pwStr(e.id).trim();
    const parent = pwStr(e.parent_id).trim();
    if (!!own === !!parent) return bad(at + "name the putaway line by id, or its split parent by parent_id");
    const lineId = own || parent;
    if (!PW_DIG.test(lineId)) return bad(at + "the line id must be digits");
    if (!storedById[lineId]) return bad(at + "line " + lineId + " is not a line of this putaway; please reload the putaway.");
    const qty = typeof e.qty === "number" ? e.qty : typeof e.qty === "string" && e.qty.trim() !== "" ? Number(e.qty) : NaN;
    if (!isFinite(qty) || qty <= 0) return bad(at + "the quantity must be a number greater than 0");
    for (const f of ["target_location", "storage_location"]) {
      if (e[f] !== undefined && e[f] !== null && pwStr(e[f]) !== "" && !PW_DIG.test(pwStr(e[f]))) return bad(at + f + " must be an id");
    }
    if (e.target_inv_category !== undefined && e.target_inv_category !== null && pwStr(e.target_inv_category) !== "" &&
      PW_CATEGORIES.indexOf(pwStr(e.target_inv_category)) < 0) return bad(at + "unknown target category " + pwStr(e.target_inv_category));
    const slot = (byLine[lineId] = byLine[lineId] || { split: !!parent, rows: [] });
    if (slot.split !== !!parent || (!parent && slot.rows.length)) return bad(at + "line " + lineId + " is both put away whole and split, or named twice");
    const row = { qty: qty };
    for (const f of ["target_location", "storage_location", "target_inv_category", "remark"]) if (e[f] !== undefined && e[f] !== null) row[f] = pwStr(e[f]);
    slot.rows.push(row);
  }
  return { ok: true, code: "", message: "", byLine: byLine, count: lines.length };
};

// allData as the desktop Putaway form sends it on Completed (onClick_workflowComplete -> this.getValues()): the stored
// header, the stored lines with this confirmation on them, the stored records. A line not confirmed puts nothing away
// (putaway_qty 0). A split line becomes the form's onClick_save_split shape: the parent (is_split Yes, no bins) and its
// children "<line_index> - <n>" (parent_or_child Child, the child's quantity as qty_to_putaway / pending / putaway, no
// handling unit); every row keeps its stored line id (children: their parent's).
const pwRebuild = function pwRebuild(to, req, aliases) {
  const header = Object.assign({}, to);
  delete header.table_putaway_item;
  delete header.table_putaway_records;
  const lineIndex = (l) => (aliases[pwStr(l.id)] !== undefined ? aliases[pwStr(l.id)] : l.line_index);
  const out = [];
  let rowCount = 0;
  for (const stored of to.table_putaway_item || []) {
    const base = pwClone(stored);
    base.line_index = lineIndex(stored);
    const slot = req.byLine[pwStr(stored.id)];
    if (!slot) {
      base.putaway_qty = 0;
      out.push(base);
      continue;
    }
    if (!slot.split) {
      const r = slot.rows[0];
      base.putaway_qty = r.qty;
      for (const f of ["target_location", "storage_location", "target_inv_category", "remark"]) if (r[f] !== undefined) base[f] = r[f];
      out.push(base);
      rowCount++;
      continue;
    }
    const total = Number(slot.rows.reduce((t, r) => t + r.qty, 0).toFixed(8));
    out.push(Object.assign(base, { is_split: "Yes", parent_or_child: "Parent", qty_to_putaway: total, putaway_qty: total, storage_location: "", target_location: "" }));
    slot.rows.forEach((r, k) => {
      const child = pwClone(stored);
      delete child.children;
      Object.assign(child, {
        line_index: lineIndex(stored) + " - " + (k + 1), received_qty: 0, qty_to_putaway: r.qty, pending_process_qty: r.qty, putaway_qty: r.qty,
        storage_location: r.storage_location !== undefined ? r.storage_location : "", target_location: r.target_location !== undefined ? r.target_location : "",
        remark: r.remark !== undefined ? r.remark : "", is_split: "No", parent_or_child: "Child", hu_data: "", handling_unit_id: "",
      });
      if (r.target_inv_category !== undefined) child.target_inv_category = r.target_inv_category;
      out.push(child);
      rowCount++;
    });
  }
  const stripEmpty = (o) => {
    for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined) delete o[k];
    return o;
  };
  return { allData: Object.assign(header, { table_putaway_item: out.map(stripEmpty), table_putaway_records: pwClone(to.table_putaway_records || []) }), rowCount: rowCount };
};

// What the background completion does not take (the classic save does, at most 500 lines): -> [reason] (empty = eligible)
const pwEligibility = function pwEligibility(A, req, costRows) {
  const reasons = [];
  const to = A.to.data || {};
  const lines = pwFlat(to.table_putaway_item);
  const why = (code, text) => {
    if (!reasons.some((r) => r.code === code)) reasons.push({ code: code, text: text });
  };
  if (pwStr(to.to_status) === "Draft" || !pwStr(to.to_id) || ["draft", "issued"].indexOf(pwStr(to.to_id)) >= 0) why("DRAFT", "a Draft putaway is numbered by the classic save");
  if (lines.some((l) => pwStr(l.item_bundle_id) || (Array.isArray(l.children) && l.children.length))) why("BUNDLE", "it has item bundles");
  // a split saved In Progress stores its rows as lines (the classic's update_node_YJRu1B3c): not a shape V2 rebuilds
  if (lines.some((l) => pwStr(l.parent_or_child) === "Child" || pwStr(l.is_split) === "Yes")) why("SPLIT_STORED", "it has split rows saved without confirming them");
  if (req.count > PW_MAX_ROWS) why("TOO_MANY_ROWS", "this confirmation has " + req.count + " rows; the background completion takes at most " + PW_MAX_ROWS);
  const flags = {};
  for (const c of costRows || []) flags[pwStr(c.material_id) + "|" + (pwStr(c.batch_id) === "0" ? "" : pwStr(c.batch_id))] = c;
  const byId = {};
  for (const l of lines) byId[pwStr(l.id)] = l;
  for (const id of Object.keys(req.byLine)) {
    const l = byId[id] || {};
    if (pwStr(l.hu_data) || pwStr(l.handling_unit_id)) why("HU", "it puts away handling units");
    const f = A.itemFlags[pwStr(l.item_code)] || {};
    if (pwNum(l.is_serialized_item) === 1 || pwNum(f.serial_number_management) === 1) why("SERIAL", "it puts away serial-numbered items");
    // INVENTORY_BULK_APPLY moves a priced isMovingInv-1 line without touching its costing rows; unpriced, it refuses UNSUPPORTED_COSTING
    if (flags[pwStr(l.item_code) + "|" + pwStr(l.batch_no)] && !(Number((parseFloat(l.unit_price) || 0).toFixed(8)) > 0)) why("COSTING", "an item with costing rows waiting for migration has no unit price on its line");
  }
  return reasons;
};

const pwChain = function pwChain(IN) {
  const R = IN.reads || {};
  const out = { route: "PLANNED", code: "200", message: "", ran: [], calls: [] };
  const run = (id) => {
    const o = __run(id);
    out.ran.push(id);
    return o;
  };
  const read = (id, value) => __set("node:" + id, { data: value });
  const stop = (code, message) => Object.assign(out, { route: "STOP", code: code, message: message || "" });
  const putawayData = { value: null };
  const loopCtx = {
    "system:tenantId": IN.tenantId, "system:uuid": IN.uuid,
    "workflowparams:arrayData": [IN.allData], "workflowparams:saveAs": "Completed", "workflowparams:pageStatus": "Edit",
  };
  if (IN.confirmedBy !== undefined && IN.confirmedBy !== null) loopCtx["workflowparams:confirmed_by"] = IN.confirmedBy;
  out.ctx = { loop: loopCtx };

  const loop = () => {
    // set_cache_node_3D7Mwerq "0" -> get_cache_node_OMu4rhrM (the first and only arrayData item)
    read("get_cache_node_OMu4rhrM", "0");
    const prep = run("code_node_kku8SAT9");
    // if_oGDoWIZe: isInvalid == 1 -> return_node_6htNCd4h (400). The classic's 500-line refusal is not the background
    // completion's (it takes up to PW_MAX_ROWS rows)
    if (pwNum(prep.isInvalid) === 1 && !PW_GUARD_500.test(pwStr(prep.invalidMessage))) return stop("400", prep.invalidMessage);
    const req = run("code_node_0rV4kqmz");
    // workflow_node_iwEQbtDk -> CHECK_REQUIRED_FIELD (v8): its one code node, in its own context
    const chk = __withContext({ "system:tenantId": IN.tenantId, "workflowparams:entry": req.data, "workflowparams:required_fields": req.required_fields },
      () => __run("code_node_AeSdXE85"));
    out.ran.push("code_node_AeSdXE85");
    read("workflow_node_iwEQbtDk", { data: chk });
    // if_iaIxbIxT: status == Failed -> return_node_5loG03ZM (400)
    if (pwStr(chk.status) === "Failed") return stop("400", chk.message);
    run("code_node_pcHu3XnW");
    // condition_or_node_item_iXJ6ZN1A (saveAs Completed) -> code_node_XZtMB79F -> workflow_node_tCxXH6MO (PUTAWAY)
    putawayData.value = run("code_node_XZtMB79F").putawayData || {};
    return null;
  };
  __withContext(loopCtx, loop);
  if (out.route !== "PLANNED") return out;

  const pwCtx = { "system:tenantId": IN.tenantId, "system:uuid": IN.uuid, "workflowparams:allData": putawayData.value };
  if (IN.confirmedBy !== undefined && IN.confirmedBy !== null) pwCtx["workflowparams:confirmed_by"] = IN.confirmedBy;
  out.ctx.putaway = pwCtx;
  const putaway = () => {
    run("code_node_M7IX2sBi");
    read("get_node_ca2032Ub", R.setup || { count: 0, data: {} });
    read("get_node_C64LC1sr", R.to || { count: 0, data: {} });
    const v = run("code_node_S8GL6e4o");
    // if_v5bYSdo9: isValid == 0 -> return_node_p3kLaRSX (400)
    if (pwNum(v.isValid) === 0) return stop("400", v.errorMessage);
    if (IN.gatesOnly) {
      out.route = "GATES";
      return null;
    }
    out.records = run("code_node_qfSZO0bi");
    // code_node_PwKeys -> sql_node_PwItems / sql_node_PwTransit -> the bridges: PREPARE's own reads, same shapes
    read("code_node_PwItems", { items: R.items || [] });
    read("code_node_PwTransit", { rows: R.transit || [] });
    out.lines = run("code_node_KbJLkjP8");
    const mv = run("code_node_M7XzDZ48");
    out.transit = run("code_node_ITmatch");
    // if_ITshort: hasShortage == 1 -> return_node_ITshort (400)
    if (pwNum(out.transit.hasShortage) === 1) return stop("400", out.transit.message);
    read("search_node_SVMdNd3K", R.others || { total: 0, count: 0, data: [] });
    read("search_node_T5BGLPpK", R.qi || { total: 0, count: 0, data: [] });
    out.gr = run("code_node_ds7jurnq");
    // loop_2zWUDmG7 over inventoryMovements: set_cache_node_sMkxQnjC "0", then dofqVRSn's nextIndex. Each iteration hands
    // dofqVRSn its own movement as a one-item list at index 0 (the whole list would be copied once per movement: O(n^2));
    // the loop index the classic sends as `index` is the iteration's
    const list = mv.inventoryMovements || [];
    const whole = __CTX["node:code_node_M7XzDZ48"];
    for (let i = 0; i < list.length; i++) {
      __CTX["node:code_node_M7XzDZ48"] = { data: { inventoryMovements: [list[i]], inventoryMovementsLength: 1 } };
      read("get_cache_node_CqyAlkUh", "0");
      const d = run("code_node_dofqVRSn");
      d.index = i;
      d.nextIndex = i + 1;
      const m = d.data || {};
      const params = {
        plant_id: m.plant_id, organization_id: m.organization_id, material_id: m.item_id, quantity: m.quantity, material_uom: m.item_uom,
        unit_price: m.unit_price, transaction_type: m.transaction_type, trx_no: m.trx_no, parent_trx_no: m.parent_trx_no,
        inventory_category: m.inventory_category, location_id: m.bin_location_id, batch_id: m.batch_id, index: d.index, isMovingInv: 1,
        handling_unit_id: d.huId,
      };
      const mov = pwStr(d.movement);
      if (mov === "OUT") {
        // workflow_node_MIAAZc1J (SUBTRACT_INVENTORY): its answer, as the classic caches it for the IN (set_cache_node_TQ0cOvRy)
        const src = m.batch_id ? (R.bbal || {})[pwBbalKey(m.item_id, m.bin_location_id, m.batch_id)] : null;
        const answer = { code: "200" };
        if (src && pwStr(src.manufacturing_date)) answer.manufacturing_date = src.manufacturing_date;
        if (src && pwStr(src.expired_date)) answer.expired_date = src.expired_date;
        for (const k of Object.keys(params)) if (params[k] === undefined || params[k] === null) delete params[k];
        out.calls.push({ index: i, direction: "SUBTRACT", params: params, source: m, answer: answer });
        read("workflow_node_MIAAZc1J", answer);
        out.lastSubtract = JSON.stringify(answer);
      } else if (mov === "IN") {
        read("get_cache_node_BztKo01z", out.lastSubtract === undefined ? null : out.lastSubtract);
        const dates = run("code_node_4Baken82");
        params.manufacturing_date = dates.manufacturing_date;
        params.expired_date = dates.expired_date;
        for (const k of Object.keys(params)) if (params[k] === undefined || params[k] === null) delete params[k];
        out.calls.push({ index: i, direction: "ADD", params: params, source: m });
        // code_node_qiSKhKkT / workflow_node_3k3T7tUz (handling units): not eligible, never reached with hu_data
        if (pwStr(m.hu_data)) return stop("NOT_ELIGIBLE", "handling units are put away by the classic save");
      } else {
        // condition_or_node_item_H4UIuRmd -> return_node_EiegwJay
        return stop("400", "Invalid movement");
      }
    }
    __CTX["node:code_node_M7XzDZ48"] = whole;
    return null;
  };
  __withContext(pwCtx, putaway);
  return out;
};

// PUTAWAY_ASYNC_SUBMIT's gates on the request + the stored TO (SUBMIT_SQL rows, pwAdapt): the stored status / classic lock
// (PUTAWAY_LOOP's LockDecide texts), the contract, what V2 does not take, then the lifted gates in the classic order:
// kku8SAT9 (400), CHECK_REQUIRED_FIELD (400), S8GL6e4o (400, against the STORED pending quantity).
// G = { request: { lines }, S: SUBMIT_SQL rows, tenantId, confirmedBy }
// -> { route: "STOP" | "NOT_ELIGIBLE" | "GO", code, message, reasons: [{code, text}], rowCount, lineCount }
const pwGates = function pwGates(G) {
  const A = pwAdapt(G.S || {});
  const res = (route, code, message, extra) => Object.assign({ route: route, code: code, message: message || "", reasons: [], rowCount: 0, lineCount: 0 }, extra || {});
  if (!A.to.count) return res("NOT_ELIGIBLE", "NOT_ELIGIBLE", "a putaway that is not saved yet is completed by the classic save", { reasons: [{ code: "ADD_MODE", text: "the putaway is not saved yet" }] });
  const to = A.to.data;
  const status = pwStr(to.to_status);
  if (status === "Completed") return res("STOP", "400", "The current putaway is already Completed");
  if (status === "Cancelled") return res("STOP", "400", "The current putaway is Cancelled");
  // code_node_LockDecide: a classic run holding the lock (is_processing, younger than 900 s) or the GR being saved in the
  // background answers "under processing"
  if ((pwNum(to.is_processing) === 1 && !(A.lockAgeSec !== null && isFinite(A.lockAgeSec) && A.lockAgeSec > 900)) || A.grStatus === "Processing") {
    return res("STOP", "400", "The current putaway is under processing");
  }
  const storedById = {};
  for (const l of pwFlat(to.table_putaway_item)) storedById[pwStr(l.id)] = l;
  const req = pwRequestRows(G.request || {}, storedById);
  if (!req.ok) return res("STOP", req.code, req.message);
  const lineCount = pwFlat(to.table_putaway_item).length;
  const reasons = pwEligibility(A, req, A.cost);
  if (reasons.length) {
    return res("NOT_ELIGIBLE", "NOT_ELIGIBLE", "this putaway is completed by the classic save: " + reasons.map((r) => r.text).join("; "),
      { reasons: reasons, rowCount: req.count, lineCount: lineCount });
  }
  const aliases = pwAliases(to.table_putaway_item);
  const storedAliased = pwClone(to);
  for (const l of storedAliased.table_putaway_item || []) if (aliases[pwStr(l.id)] !== undefined) l.line_index = aliases[pwStr(l.id)];
  const rb = pwRebuild(storedAliased, req, aliases);
  const out = pwChain({
    allData: rb.allData, confirmedBy: G.confirmedBy, tenantId: G.tenantId, uuid: "PWS", gatesOnly: true,
    reads: { to: { count: 1, data: storedAliased }, setup: { count: 0, data: {} } },
  });
  if (out.route !== "GATES") return res(out.route === "NOT_ELIGIBLE" ? "NOT_ELIGIBLE" : "STOP", out.code, pwUnalias(out.message, aliases), { rowCount: rb.rowCount, lineCount: lineCount });
  return res("GO", "200", "", { rowCount: rb.rowCount, lineCount: lineCount });
};
