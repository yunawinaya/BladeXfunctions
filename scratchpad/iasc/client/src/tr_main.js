// tr_main - Item Assembly form, transfer requests from a reserved IA (ENH-20261027-001; scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 9):
// the Transfer Request section.
//   MOUNT    a saved IA: STATUS when it links a request, or when it is Created and its organisation's Item Assembly Setup has Transfer
//            Request on (read here first: an IA of an organisation with it off opens with no extra call); a Draft without one: nothing (a
//            Draft reserves nothing). The section: Request Materials (setup on, nothing open or received; ia_create_transfer_request);
//            Requested: its line, View, Refresh, Cancel; in transit: a read-only notice (the IA can't change until it is received) and
//            View (Receive is on its form); received: its line, View, Request Replacement (something missing, or the replacement's
//            reservation ready) and Report Defect (lot_ia_receive); more than one request: the list of them on its line. Received with
//            something missing and not yet offered in this browser (a Receive from the Location Transfer list): the replacement offered
//   NEW / CREATE / REFRESH / CANCEL   IA_TRANSFER_REQUEST; the IA as this screen shows it goes along (IA1), so unsaved edits are refused
//   VIEW     the request in its own form (a dispatched one in edit mode: Receive is there)
//   STORAGE  the staging bin follows its storage location
//   RELOAD   the request's form closed after a save from VIEW: the section from STATUS; a request just received with something missing
//            offers the replacement (D6; once per receipt and browser; declined, the button stays)
//   REPLACE  something missing: sc_main GAP allocates it away from the staging bin (the staging picks stay), then the user saves the IA as
//            Created (RES-01 reserves it); the reservation ready: REPLACE sends it as the replacement request
//   DEFECT_OPEN / DEFECT / DEFECT_CLOSE   Report Defect (D2): the dialog of the IA's picks at the staging bin, per batch; DEFECT with the
//            quantities and one reason per line
// Nothing here writes the IA: IA_TRANSFER_REQUEST and the IA's own saves do.
const TR_ENABLED = __TR_ENABLED__;
const IATR_WF = "__IA_TRANSFER_REQUEST__"; // IA_TRANSFER_REQUEST
const LOT_FORM = "2013791389687349250";
/*@@IATR_RULES@@*/
/*@@IATR_IA@@*/
const trArg = arguments[0] || {};
const trS = iatrS;
const TR_ALL = ["tr_section", "tr_pick", "tr_btn_create", "tr_btn_view", "tr_btn_refresh", "tr_btn_cancel", "tr_btn_new", "tr_btn_replace", "tr_btn_defect"];
const trDigits = (v) => /^[0-9]{1,20}$/.test(trS(v));
const trNum = (v) => {
  const x = parseFloat(v);
  return isFinite(x) ? Number(x.toFixed(8)) : 0;
};
const trStore = (p) => {
  this.models["_tr"] = Object.assign({}, this.models["_tr"] || {}, p);
};
const trState = () => this.models["_tr"] || {};
const trRun = (params) => new Promise((resolve, reject) => this.runWorkflow(IATR_WF, params, (r) => resolve(r), (e) => reject(e)));
const trKey = (op, id) => ("IATR:" + trS(id) + ":" + op + ":" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 128);
// the IA as this screen shows it (iatr_ia.js iatrIaFp: the server compares it with the stored IA)
const trFp = (v) => iatrIaFp(iatrBasis({ plant: v.issuing_operation_faci, item_id: v.item_id, item_qty: v.item_qty, planned_output_qty: v.planned_output_qty,
  bom_consumption_mode: v.bom_consumption_mode, source_bom_id: v.source_bom_id }), Array.isArray(v.stock_movement) ? v.stock_movement : []);
const trYmd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
// a date widget's value (a timestamp or text) as the local YYYY-MM-DD
const trDate = (v) => (typeof v === "number" && isFinite(v) && v > 0 ? trYmd(new Date(v)) : trS(v).slice(0, 10));
const trPicks = (l) => {
  try {
    const x = JSON.parse(trS(l && l.temp_qty_data) || "[]");
    return (Array.isArray(x) ? x : []).filter((p) => p && typeof p === "object" && trNum(p.sm_quantity) > 0);
  } catch (e) {
    return [];
  }
};
// the organisation's Item Assembly Setup (D12): Transfer Request on? No row = off
const trSetupOn = async (v) => {
  try {
    const res = await db.collection("item_assembly_setup").where({ organization_id: trS(v.organization_id), is_deleted: 0 }).get();
    return ((res && res.data) || []).some((r) => r && Number(r.transfer_request_enabled) === 1);
  } catch (e) {
    console.error("IA transfer request: the setup could not be read", e);
    return false;
  }
};
const trStatus = async (v) => {
  try {
    const res = await trRun({ operation: "STATUS", ia_id: trS(v.id), organization_id: trS(v.organization_id) });
    const d = (res && res.data) || {};
    if (trS(d.code) !== "200") {
      console.error("IA transfer request: status", d);
      return null;
    }
    return JSON.parse(trS(d.result_json) || "{}");
  } catch (e) {
    console.error("IA transfer request: status failed", e);
    return null;
  }
};
// the section from STATUS (its request = the open one, else the received one, else the newest)
const trRender = (page, iaStatus, res, offer) => {
  this.hide(TR_ALL);
  const r = res && res.request ? res.request : null;
  const st = r ? trS(r.status) : "";
  const no = r ? trS(r.no) || trS(r.id) : "";
  const editable = page === "Edit";
  const gap = res && Array.isArray(res.gap) ? res.gap : [];
  trStore({ request: r, page: page, iaStatus: iaStatus, res: res || null });
  const show = [];
  let info;
  if (!r || st === "Cancelled") {
    if (!(editable && res && trS(res.can_create) === "YES")) return;
    if (!offer) {
      this.display(["tr_btn_new"]);
      return;
    }
    info = r ? "Transfer request " + no + " was cancelled. Choose the staging bin and the date to request the reserved materials again."
      : "Request this Item Assembly's reserved materials from the warehouse: choose the staging storage location and bin, and the date they are required.";
    show.push("tr_section", "tr_pick", "tr_btn_create");
  } else if (st === "In Progress" || st === "Processing") {
    info = "In transit (" + no + "): this Item Assembly can't be changed until the request is received.";
    show.push("tr_section", "tr_btn_view");
  } else if (st === "Completed") {
    info = "Transfer request " + no + " received: its materials are reserved for this Item Assembly at the staging bin.";
    if (gap.length) info += " " + gap.length + " line(s) still need materials: request a replacement.";
    else if (trS(res.replace_ready) === "YES") info += " The missing materials are reserved: request the replacement.";
    show.push("tr_section", "tr_btn_view");
    if (editable && iaStatus === "Created") {
      if (gap.length || trS(res.replace_ready) === "YES") show.push("tr_btn_replace");
      show.push("tr_btn_defect");
    }
  } else {
    info = "Transfer request " + no + " · " + st;
    if (st === "Requested" && trS(r.stale) === "YES") info += " · this Item Assembly's reservation changed since it was made: refresh it";
    show.push("tr_section", "tr_btn_view");
    if (st === "Requested" && editable) show.push("tr_btn_refresh", "tr_btn_cancel");
  }
  // the IA's requests, newest first (a replacement, its received request, a cancelled one), once there is more than one
  const history = res && Array.isArray(res.history) ? res.history.filter((h) => h && trS(h.no)) : [];
  if (history.length > 1) info += " · Requests: " + history.map((h) => trS(h.no) + " (" + trS(h.status) + ")").join(", ");
  this.setData({ tr_info: info });
  this.display(show);
};
// after an operation: the section from STATUS now (an unreadable status keeps what is shown)
const trAgain = async (v) => {
  const st = trState();
  const res = await trStatus(v);
  if (res) trRender(st.page || "Edit", st.iaStatus || trS(v.item_assembly_status), res);
  return res;
};
const trAnswer = async (v, res, failed) => {
  const d = (res && res.data) || {};
  if (trS(d.code) === "200") {
    this.$message.success(trS(d.message) || "Done.");
    try {
      const out = JSON.parse(trS(d.result_json) || "{}");
      if (out.request && trDigits(out.request.id)) this.setData({ transfer_request_id: trS(out.request.id), transfer_request_no: trS(out.request.no) });
    } catch (e) {}
    await trAgain(v);
    return true;
  }
  this.$message.error(trS(d.message) || failed);
  return false;
};
const trConfirm = (text, title, ok) => this.$confirm(text, title, { confirmButtonText: ok, cancelButtonText: "Not now", type: "warning" }).then(() => true, () => false);
// the replacement offered once per receipt and browser (D6): right after a Receive (RELOAD), else at the next open of the IA (a Receive
// done from the Location Transfer list); declined, Request Replacement stays. A browser that can't remember is not offered at open
const TR_OFFER = "iatr-offer:";
const trOffered = (id) => {
  try {
    return localStorage.getItem(TR_OFFER + id) === "1";
  } catch (e) {
    return true;
  }
};
const trOffer = async (v, res) => {
  try {
    localStorage.setItem(TR_OFFER + trS(res.request.id), "1");
  } catch (e) {}
  const ok = await trConfirm(res.gap.length + " line(s) of this Item Assembly still need materials after the receipt (a defect, or never reserved). Allocate them now for a "
    + "replacement request? You can do it later with Request Replacement.", "Request a replacement", "Allocate");
  if (ok) await trReplace(v, res);
};
// received with something missing, on an editable Created IA
const trDue = (res, page, iaStatus) => !!(res && res.request && trS(res.request.status) === "Completed" && Array.isArray(res.gap) && res.gap.length && page === "Edit" &&
  iaStatus === "Created");
// Request Replacement: something missing -> its allocation (sc_main GAP); the reservation ready -> REPLACE to the staging bin, dated today
const trReplace = async (v, res) => {
  const gap = res && Array.isArray(res.gap) ? res.gap : [];
  const staging = (res && res.staging) || {};
  if (gap.length) {
    this.triggerEvent("sc_main", { scOp: "GAP", gap: gap, bin: trS(staging.bin) });
    return;
  }
  if (!res || trS(res.replace_ready) !== "YES") return;
  this.showLoading("Requesting the replacement...");
  let out = null;
  try {
    out = await trRun({ operation: "REPLACE", ia_id: trS(v.id), organization_id: trS(v.organization_id), expected_fp: trFp(v), storage_location_id: trS(staging.sl),
      location_id: trS(staging.bin), required_date: trYmd(new Date()), idempotency_key: trKey("replace", v.id) });
  } catch (e) {
    console.error("IA transfer request: replace failed", e);
  }
  this.hideLoading();
  await trAnswer(v, out, "The replacement request could not be made. Please try again.");
};
// Report Defect: one row per pick at the staging bin (a batch line per batch), its batch number read
const trDefectRows = async (v, bin) => {
  const rows = [];
  for (const l of Array.isArray(v.stock_movement) ? v.stock_movement : []) {
    if (!l || !trDigits(l.id)) continue;
    for (const p of trPicks(l)) {
      if (trS(p.location_id) !== trS(bin) || trS(p.handling_unit_id)) continue;
      rows.push({ line_id: trS(l.id), item: trS(l.item_name) || trS(l.item_selection), batch_id: trS(p.batch_id), batch: "", at_bin: trNum(p.sm_quantity), defect: 0, reason: "" });
    }
  }
  const ids = Array.from(new Set(rows.map((r) => r.batch_id).filter((x) => x)));
  if (ids.length) {
    try {
      const res = await db.collection("batch").filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: ids },
        { prop: "is_deleted", operator: "equal", value: 0 }] }]).limit(ids.length).get();
      const no = {};
      for (const b of (res && res.data) || []) no[trS(b.id)] = trS(b.batch_number);
      rows.forEach((r) => (r.batch = r.batch_id ? no[r.batch_id] || r.batch_id : ""));
    } catch (e) {
      rows.forEach((r) => (r.batch = r.batch_id));
    }
  }
  return rows;
};
// the dialog's rows -> DEFECT's { <IA line id>: { qty, reason } | { batches: { <batch id>: qty }, reason } }, or the reason it can't go
const trDefects = (rows) => {
  const out = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const q = trNum(r && r.defect);
    if (!(q > 0)) continue;
    const label = trS(r.item) + (trS(r.batch) ? " (" + trS(r.batch) + ")" : "");
    if (q - trNum(r.at_bin) > 1e-8) return { why: label + ": at most " + trNum(r.at_bin) + " is at the staging bin." };
    if (!trS(r.reason)) return { why: label + ": choose the reason for the defect." };
    const d = out[trS(r.line_id)] || (out[trS(r.line_id)] = { reason: trS(r.reason) });
    if (d.reason !== trS(r.reason)) return { why: trS(r.item) + ": one reason per line - choose the same reason for its batches." };
    if (trS(r.batch_id)) {
      d.batches = d.batches || {};
      d.batches[trS(r.batch_id)] = String(trNum((trNum(d.batches[trS(r.batch_id)]) || 0) + q));
    } else d.qty = String(trNum(trNum(d.qty) + q));
  }
  if (!Object.keys(out).length) return { why: "Enter the defective quantity of at least one line." };
  const defects = {};
  for (const id of Object.keys(out)) defects[id] = out[id].batches ? { batches: out[id].batches, reason: out[id].reason } : { qty: out[id].qty, reason: out[id].reason };
  return { defects: defects };
};

(async () => {
  const op = trS(trArg.trOp);
  try {
    if (op === "MOUNT") {
      const page = trS(trArg.pageStatus);
      if (TR_ENABLED !== true || (page !== "Edit" && page !== "View")) return;
      const v = this.getValues();
      if (!trDigits(v.id)) return;
      const iaStatus = trS(trArg.status) || trS(v.item_assembly_status);
      trStore({ request: null, page: page, iaStatus: iaStatus, res: null });
      if (!trS(v.transfer_request_id)) {
        // no request yet: only an editable Created IA of an organisation with Transfer Request on may make one (D12)
        if (page !== "Edit" || iaStatus !== "Created" || !(await trSetupOn(v))) return;
      }
      const res = await trStatus(v);
      if (res) trRender(page, iaStatus, res);
      if (trDue(res, page, iaStatus) && !trOffered(trS(res.request.id))) await trOffer(v, res);
      return;
    }
    if (op === "NEW") {
      const st = trState();
      trRender(st.page || "Edit", st.iaStatus || "Created", Object.assign({}, st.res || {}, { request: st.request || null, can_create: "YES" }), true);
      return;
    }
    // the request's form closed after a save opened from View Transfer Request: its section drawn again; just received with something
    // missing (D6): the replacement offered
    if (op === "RELOAD") {
      const v = this.getValues();
      if (TR_ENABLED !== true || !trDigits(v.id) || !trS(v.transfer_request_id)) return;
      const was = trS((trState().request || {}).status);
      const res = await trAgain(v);
      const st = trState();
      if (was !== "Completed" && trDue(res, st.page, st.iaStatus)) await trOffer(v, res);
      return;
    }
    if (op === "STORAGE") {
      this.setData({ tr_location_id: "" });
      return;
    }
    const v = this.getValues();
    const r = trState().request || {};
    if (op === "VIEW") {
      if (!trDigits(r.id)) return;
      const edit = trS(r.status) === "In Progress";
      // on the right, as every form opens (the user, 10-28)
      const view = { target: LOT_FORM, type: edit ? "edit" : "view", mode: "dialog", position: "rtl", title: edit ? "Edit" : "View", width: "80%", data: { id: trS(r.id) } };
      if (!edit) view.viewMode = "disabled";
      this.toView(view);
      return;
    }
    if (op === "CREATE") {
      const sl = trS(v.tr_storage_location_id);
      const bin = trS(v.tr_location_id);
      const date = trDate(v.tr_required_date);
      if (!trDigits(sl) || !trDigits(bin) || !date) {
        this.$message.warning("Choose the staging storage location, the bin and the date the materials are required.");
        return;
      }
      this.showLoading("Creating the transfer request...");
      let res = null;
      try {
        res = await trRun({ operation: "CREATE", ia_id: trS(v.id), organization_id: trS(v.organization_id), expected_fp: trFp(v), storage_location_id: sl, location_id: bin,
          required_date: date, idempotency_key: trKey("create", v.id) });
      } catch (e) {
        console.error("IA transfer request: create failed", e);
      }
      this.hideLoading();
      await trAnswer(v, res, "The transfer request could not be created. Please try again.");
      return;
    }
    if (op === "REPLACE") {
      await trReplace(v, trState().res);
      return;
    }
    if (op === "DEFECT_OPEN") {
      const staging = (trState().res || {}).staging || {};
      const rows = await trDefectRows(v, trS(staging.bin));
      if (!rows.length) {
        this.$message.warning("Nothing of this Item Assembly is picked at the staging bin.");
        return;
      }
      // a dialog's children are addressed through it (sc_main's "sc_line_dialog.sc_line_table")
      this.setData({ "tr_defect_dialog.tr_defect_table": rows });
      await this.openDialog("tr_defect_dialog");
      return;
    }
    if (op === "DEFECT_CLOSE") {
      await this.closeDialog("tr_defect_dialog");
      return;
    }
    if (op === "DEFECT") {
      const d = trDefects((this.getValues().tr_defect_dialog || {}).tr_defect_table);
      if (d.why) {
        this.$message.warning(d.why);
        return;
      }
      this.showLoading("Reporting the defect...");
      let res = null;
      try {
        res = await trRun({ operation: "DEFECT", ia_id: trS(v.id), organization_id: trS(v.organization_id), defects: JSON.stringify(d.defects), idempotency_key: trKey("defect", v.id) });
      } catch (e) {
        console.error("IA transfer request: defect failed", e);
      }
      this.hideLoading();
      if (trS(((res && res.data) || {}).code) === "200") await this.closeDialog("tr_defect_dialog");
      await trAnswer(v, res, "The defect could not be reported. Please try again.");
      return;
    }
    if (op === "REFRESH" || op === "CANCEL") {
      if (!trDigits(r.id)) return;
      const refresh = op === "REFRESH";
      const ok = await trConfirm(refresh ? "Refresh transfer request " + trS(r.no) + " from this Item Assembly's reservation? Its lines and picks become what is reserved now." :
        "Cancel transfer request " + trS(r.no) + "? Nothing has moved yet: the Item Assembly keeps its reservation, and you can make a new request afterwards.",
      refresh ? "Refresh transfer request" : "Cancel transfer request", refresh ? "Refresh" : "Cancel Request");
      if (!ok) return;
      this.showLoading(refresh ? "Refreshing the transfer request..." : "Cancelling the transfer request...");
      const params = { operation: op, ia_id: trS(v.id), organization_id: trS(v.organization_id), lot_id: trS(r.id), idempotency_key: trKey(op.toLowerCase(), v.id) };
      if (refresh) params.expected_fp = trFp(v);
      let res = null;
      try {
        res = await trRun(params);
      } catch (e) {
        console.error("IA transfer request: " + op + " failed", e);
      }
      this.hideLoading();
      await trAnswer(v, res, "The transfer request could not be " + (refresh ? "refreshed" : "cancelled") + ". Please try again.");
    }
  } catch (error) {
    this.hideLoading();
    console.error("IA transfer request:", error);
    this.$message.error(error.message || "Transfer request: something went wrong");
  }
})();
