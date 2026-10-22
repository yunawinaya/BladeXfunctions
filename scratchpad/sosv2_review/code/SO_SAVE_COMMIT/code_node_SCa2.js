// SO Save V2 - shared helpers (included at the top of every code node by scripts/build-so-save-v2.mjs)
const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const list = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r);
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
const num = (v) => Number(v || 0);
const answer = (route, code, message, extra) => Object.assign({ route: route, code: String(code), message: message || "" }, extra || {});
const soParse = (t) => {
  if (t && typeof t === "object") return t;
  try {
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
};
// "YYYY-MM-DD HH:MM:SS" (the DB clock, MYT on dev) + seconds
const dbAddSeconds = function dbAddSeconds(text, seconds) {
  const m = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) + seconds * 1000);
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
};
// a request's fingerprint (not security): two FNV-1a lanes over the text, 16 hex
const soHash = function soHash(text) {
  const t = String(text);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2 * (i & 7)) >>> 0;
  }
  const h = (n) => ("0000000" + n.toString(16)).slice(-8);
  return h(a) + h(b);
};
// a SO's lines with their bundle children, as one list (children carry no `children` of their own here)
const soFlatLines = (rows) => list(rows).flatMap((r) => [r].concat(list(r.children)));
// the SAVE_SO job statuses that hold a sales order
const SO_JOB_OPEN = ["QUEUED", "PREPARING", "CASCADE_PREPARING", "AWAITING_CONFIRMATION", "READY_TO_COMMIT", "COMMITTING_SO", "RELEASING", "AFTER", "REQUIRES_REVIEW"];

const SO_HEADER_EDIT = ["id","so_description","created_source","wa_number","wa_group","so_no","so_date","customer_name","plant_name","cust_billing_address","cust_shipping_address","so_payment_term","so_shipping_date","so_delivery_method","table_so","so_total_gross","so_total_discount","so_total_tax","so_total","so_sales_person","so_remarks","so_tnc","so_payment_details","shipping_address_line_4","shipping_postal_code","shipping_address_state","billing_address_fax","billing_address_code","shipping_address_code","shipping_address_fax","billing_address_city","billing_address_country","shipping_address_city","shipping_address_line_1","billing_address_state","shipping_address_line_3","billing_address_line_1","billing_address_line_3","billing_address_line_4","shipping_address_country","billing_postal_code","billing_address_line_2","shipping_address_line_2","so_currency","cs_shipping_date","ss_shippping_date","ss_est_arrival_date","cs_courier_company","cp_vehicle_number","delivery_method_text","ct_driver_contact_no","cp_driver_contact_no","ct_delivery_cost","ct_driver_name","cp_pickup_date","ct_est_delivery_date","ss_freight_charges","ct_vehicle_number","ss_shipping_company","ss_tracking_number","cp_driver_name","est_arrival_date","so_status","sqt_no","organization_id","si_posted_status","myr_total_amount","exchange_rate","tpt_vehicle_number","tpt_driver_contact_no","di_shipping_method","di_driver_name","di_ic_no","di_driver_contact_no","di_shipping_company","di_transport_name","di_vehicle_number","di_est_delivery_date","di_est_arrival_date","di_pickup_date","di_validity_of_collection","di_tracking_number","di_freight_charges","project_id","tpt_transport_name","ct_ic_no","tpt_ic_no","so_docno","total_gross_currency","exchange_rate_myr","total_amount_myr","exchange_rate_currency","total_tax_currency","total_discount_currency","total_amount_currency","cp_ic_no","validity_of_collection","cs_tracking_number","ss_shipping_method","partially_delivered","fully_delivered","sr_status","srr_status","so_ref_doc","cs_freight_charges","billing_attention","shipping_attention","shipping_address_phone","shipping_address_name","billing_address_name","billing_address_phone","overdue_inv_total_amount","last_sync_date","outstanding_balance","is_accurate","customer_credit_limit","overdue_limit","acc_integration_type","sqt_id","so_created_by","cust_po","so_remarks2","so_remarks3","cust_po_date","access_group","price_tag_id","to_status","packing_status","so_no_type","previous_status","need_cl","posted_status","so_remarks5","so_remarks4","so_delivery_term","so_area_id","so_agent_user_id","tpt_driver_name","auto_si","auto_gd","so_type","create_si","approval_condition","custom_fields_m07krnod"];
const SO_HEADER_ADD = ["so_description","created_source","wa_number","wa_group","so_no","so_date","customer_name","plant_name","cust_billing_address","cust_shipping_address","so_payment_term","so_shipping_date","so_delivery_method","table_so","so_total_gross","so_total_discount","so_total_tax","so_total","so_sales_person","so_remarks","so_tnc","so_payment_details","shipping_address_line_4","shipping_postal_code","shipping_address_state","billing_address_city","billing_address_country","billing_address_fax","billing_address_code","shipping_address_code","shipping_address_fax","shipping_address_city","shipping_address_line_1","billing_address_state","shipping_address_line_3","billing_address_line_1","billing_address_line_3","billing_address_line_4","shipping_address_country","billing_postal_code","billing_address_line_2","shipping_address_line_2","so_currency","cs_shipping_date","ss_shippping_date","ss_est_arrival_date","cs_courier_company","cp_vehicle_number","delivery_method_text","ct_driver_contact_no","cp_driver_contact_no","ct_delivery_cost","ct_driver_name","cp_pickup_date","ct_est_delivery_date","ss_freight_charges","ct_vehicle_number","ss_shipping_company","ss_tracking_number","cp_driver_name","est_arrival_date","si_status","so_status","gd_status","sqt_no","organization_id","si_posted_status","myr_total_amount","exchange_rate","tpt_vehicle_number","tpt_driver_contact_no","di_shipping_method","di_driver_name","di_ic_no","di_driver_contact_no","di_shipping_company","di_transport_name","di_vehicle_number","di_est_delivery_date","di_est_arrival_date","di_pickup_date","di_validity_of_collection","di_tracking_number","di_freight_charges","project_id","tpt_transport_name","ct_ic_no","tpt_ic_no","so_docno","total_gross_currency","exchange_rate_myr","total_amount_myr","exchange_rate_currency","total_tax_currency","total_discount_currency","total_amount_currency","cp_ic_no","validity_of_collection","cs_tracking_number","ss_shipping_method","partially_delivered","fully_delivered","sr_status","srr_status","so_ref_doc","cs_freight_charges","billing_attention","shipping_attention","shipping_address_phone","shipping_address_name","billing_address_name","billing_address_phone","production_status","overdue_inv_total_amount","last_sync_date","outstanding_balance","is_accurate","customer_credit_limit","overdue_limit","acc_integration_type","sqt_id","so_created_by","cust_po","so_remarks2","so_remarks3","cust_po_date","access_group","price_tag_id","to_status","packing_status","so_no_type","previous_status","need_cl","posted_status","so_remarks5","so_remarks4","so_delivery_term","so_area_id","so_agent_user_id","tpt_driver_name","auto_si","auto_gd","so_type","create_si","approval_condition","custom_fields_m07krnod"];
const SO_LINE_FIELDS = ["id","sales_order_id","item_name","item_id","so_desc","more_desc","further_description","unrestricted_qty","base_unrestricted_qty","so_quantity","bundle_ratio","min_quantity","max_quantity","so_item_uom","so_item_price","so_gross","so_discount","so_discount_uom","so_discount_amount","so_tax_preference","so_tax_percentage","so_tax_amount","min_price","max_price","so_tax_inclusive","so_brand","so_packaging_style","so_amount","tariff_id","net_weight","weight_conversion","packing_qty","packing_uom","packing_conversion","delivered_qty","from_historical","planned_qty","outstanding_quantity","invoice_qty","posted_qty","production_qty","production_planned_qty","production_status","return_qty","line_remark_1","line_remark_2","line_remark_3","so_shipping_date","project_id","item_category_id","access_group","plant_id","sqt_id","sqt_line_id","sqt_created_by_id","customer_id","item_bundle_id","payment_term_id","sales_person_id","billing_state_Id","shipping_state_id","billing_country_id","shipping_country_id","area_id","agent_user_id","line_index","organization_id","line_status","si_status","packing_status","source_po_line_item_id","table_uom_conversion","packing_no","hu_no","custom_fields","create_user","create_dept","create_time","update_user","update_time","is_deleted","tenant_id","parent_id"];
// ---- SO Save V2 rules
// SO Save V2 - the column rules and the cell comparison shared by SO_SAVE_PREPARE and SO_SAVE_COMMIT (included by
// scripts/build-so-save-v2.mjs after common.js).

// written by other documents (handoff 6.1): never in the plan of an edit
const SO_HEADER_OWNED = ["gd_status", "si_status", "production_status", "sr_status", "srr_status", "posted_status", "si_posted_status", "partially_delivered", "fully_delivered",
  "to_status", "packing_status", "is_processing"];
const SO_HEADER_NUMBER = ["so_no", "so_no_type"]; // decided by COMMIT S0N from the stored record
const SO_LINE_OWNED = ["planned_qty", "delivered_qty", "invoice_qty", "posted_qty", "si_status", "return_qty", "production_planned_qty", "production_qty", "production_status",
  "packing_status", "packing_no", "hu_no"];
const SO_LINE_SYSTEM = ["id", "sales_order_id", "parent_id", "create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "tenant_id"];

// A cell's comparable text: null / absent / "" alike; numbers by their decimal text (2300 = "2300.00000000", ids exact);
// JSON (objects, arrays, JSON text) by its key-sorted text. Two cells differ only when these differ; a spurious
// difference costs one write of the value classic would have written anyway.
const soCanonJson = function soCanonJson(v) {
  if (Array.isArray(v)) return "[" + v.map(soCanonJson).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + soCanonJson(v[k])).join(",") + "}";
  return soCanon(v);
};
const soCanon = function soCanon(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") return "J" + soCanonJson(v);
  const t = String(v).trim();
  const m = t.match(/^([-+]?)(\d+)(?:\.(\d*))?$/);
  if (m) {
    const int = m[2].replace(/^0+(?=\d)/, "");
    const frac = (m[3] || "").replace(/0+$/, "");
    const body = int + (frac ? "." + frac : "");
    return (m[1] === "-" && body !== "0" ? "-" : "") + body;
  }
  if (/^[\[{]/.test(t)) {
    try {
      return "J" + soCanonJson(JSON.parse(t));
    } catch (e) {
      /* plain text */
    }
  }
  return t;
};
const soSame = (a, b) => soCanon(a) === soCanon(b);

// ---- SO_SAVE_COMMIT
// SO_SAVE_COMMIT - writes the plan SO_SAVE_PREPARE stored (docs/lowcode/so-save-v2/PLAN.md, "SO_SAVE_COMMIT design").
// One phase per worker call: A (S0 revalidate, S1 header / new SO, S0N number), B (S2 lines, one plan part per call),
// C (S3 release the cascade's holds, S4 unlock, S5 after-steps). Every step records a DONE row SOJ|<job> / <step>
// (unique), so a re-run skips it; every write is read back, and a read-back that disagrees -> REQUIRES_REVIEW (the SO
// stays locked: nothing else writes it until someone looks).
// Generated above this file by the build: SO_HEADER_EDIT / SO_HEADER_ADD (classic's update / add node props),
// SO_LINE_FIELDS (the line table's fields); rules.js: SO_HEADER_OWNED, SO_HEADER_NUMBER, SO_LINE_OWNED, SO_LINE_SYSTEM,
// soCanon / soSame.

const SO_COMMIT_STEPS_A = ["S0", "S1", "S0N"];

// the columns each write maps (every row carries every one of them)
const soCommitHeaderCols = () => SO_HEADER_EDIT.filter((c) => c !== "id" && c !== "table_so" && SO_HEADER_OWNED.indexOf(c) < 0 && SO_HEADER_NUMBER.indexOf(c) < 0);
const soCommitLineUpdCols = () => SO_LINE_FIELDS.filter((c) => SO_LINE_SYSTEM.indexOf(c) < 0 && SO_LINE_OWNED.indexOf(c) < 0);
const soCommitLineAddCols = () => SO_LINE_FIELDS.filter((c) => SO_LINE_SYSTEM.indexOf(c) < 0);
const soCommitAddCols = () => SO_HEADER_ADD.concat(["is_processing"]);

const soCommitGuard = function soCommitGuard(inp) {
  const out = { route: "", code: "", message: "", reason: "", tenantId: "0", jobIdSql: "0", rowVersion: -1, nonce: "" };
  out.nonce = s(inp.uuid).replace(/[^0-9A-Za-z]/g, "").slice(0, 24);
  const reject = (why) => Object.assign(out, answer("REJECT", "400", why));
  if (!digits(inp.tenantId)) return reject("no session tenant");
  out.tenantId = s(inp.tenantId);
  if (!digits(inp.jobId)) return reject("job_id: digits");
  out.jobIdSql = s(inp.jobId);
  if (!/^[0-9]{1,9}$/.test(s(inp.rowVersion))) return reject("row_version: the worker's claim");
  out.rowVersion = Number(s(inp.rowVersion));
  if (!out.nonce) return reject("no run nonce");
  return Object.assign(out, answer("GO", "", ""));
};

// The fields a stop (FAILED / REQUIRES_REVIEW: the job, the unlock, the holds to cancel) reads, so every node that may
// stop carries them.
const soCommitTail = function soCommitTail(gate) {
  return { route: "", code: "", message: "", reason: "", needJob: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], needCancel: "NO", cancelHolds: [], cancelOp: "CANCEL_HELD",
    cascadeRef: s((gate || {}).cascadeRef) };
};

const soCommitJobRow = function soCommitJobRow(gate, o) {
  return Object.assign({ id: gate.jobId, job_status: "COMMITTING_SO", progress_percent: 40, progress_message: "Saving", error_code: "", error_message: "", error_details: "",
    finished_at: null }, o);
};
const soCommitStep = function soCommitStep(gate, name, ref) {
  return { job_id: "SOJ|" + gate.jobId, organization_id: gate.organizationId, step_name: name, step_status: "DONE", attempt_count: 0, started_at: gate.dbNow, finished_at: gate.dbNow,
    result_ref: ref === undefined ? "" : typeof ref === "string" ? ref : JSON.stringify(ref) };
};
// The answer that ends this call with a job outcome: FAILED (before S1: nothing written; the holds cancelled, the SO
// unlocked) or REQUIRES_REVIEW (after a write: the SO stays locked).
const soCommitStop = function soCommitStop(gate, out, status, code, message) {
  const failed = status === "FAILED";
  return Object.assign(out, { route: failed ? "FAIL" : "REVIEW", code: failed ? "500" : "409", message: message, reason: code,
    jobRows: [soCommitJobRow(gate, { job_status: status, progress_percent: 100, progress_message: (failed ? "Not saved: " : "Needs review: ") + message, error_code: code,
      error_message: message, finished_at: gate.dbNow })],
    needJob: "YES", needUnlock: failed && gate.isEdit === "YES" ? "YES" : "NO", unlockRows: failed && gate.isEdit === "YES" ? [{ id: gate.soId, is_processing: 0 }] : [],
    cancelHolds: failed ? gate.holds : [], needCancel: failed && gate.holds.length ? "YES" : "NO", cancelOp: "CANCEL_HELD", cascadeRef: gate.cascadeRef });
};

// Gate: this worker's claim (READY_TO_COMMIT / COMMITTING_SO / RELEASING / AFTER at its row version), the plan, the steps
// done -> the phase this call runs.
const soCommitGate = function soCommitGate(guard, factRows) {
  const f = list(factRows)[0] || {};
  const pp = soParse(f.prepared_payload) || {};
  const done = {};
  for (const d of list(soParse(f.done_steps))) if (s(d.step)) done[s(d.step)] = s(d.ref);
  const out = { ...soCommitTail({ cascadeRef: "SOV2|" + s(f.job_id) }), route: "STOP", code: "409", dbNow: s(f.db_now), jobId: s(f.job_id), isEdit: "NO", soId: "0", soIdSql: "0",
    organizationId: digits(f.organization_id) ? s(f.organization_id) : "0", idemKey: s(f.idempotency_key), planRef: "", lPart: "", lParts: [], phase: "", done: done,
    holds: [], holdIdsSql: "0", storedIdsSql: "0", tempNo: "", draftSince: "9999-12-31 00:00:00" };
  if (!s(f.job_id)) return Object.assign(out, { code: "404", message: "Save job not found" });
  const st = s(f.job_status);
  if (["READY_TO_COMMIT", "COMMITTING_SO", "RELEASING", "AFTER"].indexOf(st) < 0 || num(f.row_version) !== guard.rowVersion) {
    return Object.assign(out, { message: "Not this worker's claim (job " + st + ", row version " + num(f.row_version) + ")", reason: "claim" });
  }
  out.isEdit = s(f.correlation_id).indexOf("SO|") === 0 && s(pp.mode) !== "ADD" ? "YES" : "NO";
  const corrSo = (s(f.correlation_id).match(/^SO\|([0-9]+)$/) || [])[1] || "";
  // a new SO has an id once S1 inserted it (S1's DONE row carries it, and the job's correlation names it)
  const s1 = soParse(done.S1) || {};
  out.soId = corrSo || (digits(s1.soId) ? s(s1.soId) : "0");
  out.soIdSql = out.soId;
  out.planRef = /^SOP\|[0-9A-Za-z]{1,24}$/.test(s(pp.plan)) ? s(pp.plan) : "";
  if (!out.planRef) return soCommitStop(out, out, "REQUIRES_REVIEW", "SOV2_PARTS", "the job has no usable plan");
  // an edit writes its lines in phase B; a new SO's lines went in with the document (S1)
  out.lParts = [];
  if (out.isEdit === "YES") for (let i = 1; i <= num(pp.parts) - 2; i++) out.lParts.push("L|" + ("00" + i).slice(-3));
  out.tempNo = "SOV2-" + out.jobId;
  // a new Draft's insert intent (S1I, its time): only a run after one looks for the draft it inserted, and only among
  // drafts created since (no intent: a time no row has)
  out.draftSince = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s(done.S1I)) ? s(done.S1I) : "9999-12-31 00:00:00";
  out.holds = list(pp.holds).filter((h) => digits(h.job_id) && digits(h.gd_id)).map((h) => ({ gd_id: s(h.gd_id), job_id: s(h.job_id), gd_no: s(h.gd_no), note: s(h.note) }));
  out.holdIdsSql = out.holds.length ? out.holds.map((h) => h.job_id).join(",") : "0";
  if (SO_COMMIT_STEPS_A.some((k) => !(k in done))) out.phase = "A";
  else {
    const next = out.lParts.find((k) => !(("S2|" + k.slice(2)) in done));
    if (next) {
      out.phase = "B";
      out.lPart = next;
    } else out.phase = "C";
  }
  // the lock: an edit's SO (and a new SO once inserted) is flagged under this job's lock; in phase C the flag may
  // already be down (S4 unlocked it and the run ended before S4's DONE row): the latest lock row still names this job
  const ours = s(f.lock_ref) === out.idemKey;
  if (out.soId !== "0" && (!ours || (num(f.is_processing) !== 1 && out.phase !== "C"))) {
    return soCommitStop(out, out, "REQUIRES_REVIEW", "SOV2_LOCK", "the sales order's lock is not this job's");
  }
  return Object.assign(out, { route: "GO", code: "", message: "" });
};

const soCommitPart = (rows, name) => soParse((list(rows).find((r) => s(r.step_name) === name) || {}).result_ref);
const soCommitStoredRec = (storedData) => (Array.isArray(storedData) ? storedData[0] : storedData) || null;
const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
// A whole row: the plan's cells over the stored values. A get-node record leaves out a column whose value is '' as well
// as a null one (F52), so blanks (the text columns that hold '' now, read by SQL) keep their ''.
const soCommitFull = function soCommitFull(stored, set, cols, blanks) {
  const row = {};
  for (const c of cols) row[c] = has(set, c) ? set[c] : has(stored, c) ? stored[c] : blanks && blanks[c] ? "" : null;
  return row;
};
// blank rows: [{ id?, blanks: "col,col" }] -> { col: true } (by line id for lines)
const soCommitBlanks = (rows) => {
  const out = {};
  for (const r of list(rows)) {
    const m = {};
    for (const c of s(r.blanks).split(",")) if (c) m[c] = true;
    out[s(r.id) || "header"] = m;
  }
  return out;
};

// Phase A, node 1: S0 (revalidate), S1 (the header write or the new SO's insert), the S0N decision.
// storedData: the SO as stored now (an edit); holdRows: the cascade's held GD jobs; foundRows: a new SO this job already
// inserted (kind TEMP: under its temporary number gate.tempNo SOV2-<job>, numbering type -9999, which the unique so_no
// index guards; kind DRAFT: a Draft of this organization still flagged, created by the job's user since it was queued).
// A new Draft is inserted with so_no 'draft' and the issue rule, as classic's add: the platform numbers it on INSERT from
// the organization's draft rule (an update writing 'draft' is not numbered: SO 2113092901293342721 kept 'draft').
const soCommitA = function soCommitA(guard, gate, partRows, storedData, holdRows, foundRows, blankRows) {
  const out = { route: "A", code: "200", message: "", reason: "", jobRows: [], stepRows: [], needSteps: "NO", s1Rows: [], needS1: "NO", headerRows: [], needHeader: "NO", insertRows: [], needInsert: "NO",
    needUnlock: "NO", unlockRows: [], cancelHolds: [], needCancel: "NO", tempNo: "", numberPlan: {}, draftInsert: "NO", draftSince: gate.draftSince };
  const H = soCommitPart(partRows, "H|000");
  if (!H) return soCommitStop(gate, out, "REQUIRES_REVIEW", "SOV2_PARTS", "the plan of this save is missing");
  const stored = soCommitStoredRec(storedData);
  const steps = [];
  const edit = H.mode === "EDIT";
  // S0: nothing is written yet - the stored SO as the plan saw it, every hold still held
  if (!("S0" in gate.done)) {
    if (edit) {
      if (!stored || s(stored.id) !== gate.soId) return soCommitStop(gate, out, "FAILED", "SOV2_NO_SO", "the sales order could not be read");
      for (const c of Object.keys(H.before || {})) {
        if (!soSame(H.before[c], stored[c])) return soCommitStop(gate, out, "FAILED", "SOV2_CHANGED", "the sales order was changed by another save (" + c + "): reopen it and save again");
      }
      const now = soFlatLines(stored.table_so).filter((r) => s(r.id)).map((r) => s(r.id)).sort();
      const then = list(H.storedLineIds).map(String).sort();
      if (JSON.stringify(now) !== JSON.stringify(then)) return soCommitStop(gate, out, "FAILED", "SOV2_CHANGED", "lines of the sales order changed meanwhile: reopen it and save again");
    }
    const held = {};
    for (const h of list(holdRows)) held[s(h.id)] = s(h.job_status);
    const lost = gate.holds.filter((h) => held[h.job_id] !== "HELD");
    if (lost.length) return soCommitStop(gate, out, "FAILED", "SOV2_HOLD_LOST", "the change to delivery " + (lost[0].gd_no || lost[0].gd_id) + " is no longer held: save again");
    steps.push(soCommitStep(gate, "S0"));
    out.jobRows = [soCommitJobRow(gate, { progress_percent: 40, progress_message: "Saving the sales order" })];
  }
  // S1
  if (!("S1" in gate.done)) {
    if (edit) {
      // the whole classic header row: the stored values, the plan's cells over them (owned and number columns left out)
      if (Object.keys(H.set || {}).length) {
        out.headerRows = [Object.assign({ id: gate.soId }, soCommitFull(stored, H.set, soCommitHeaderCols(), soCommitBlanks(blankRows).header))];
        out.needHeader = "YES";
      }
      // its DONE row after the write (a run killed in between writes the header again: the same values)
      out.s1Rows = [soCommitStep(gate, "S1", { soId: gate.soId })];
      out.needS1 = "YES";
    } else {
      const n0 = H.number || {};
      const draft = s(H.saveAs) === "Draft" && s(n0.so_no_type) !== "-9999" && s(n0.so_no_type) !== "";
      out.draftInsert = draft ? "YES" : "NO";
      const already = list(foundRows).some((r) => (draft ? s(r.kind) === "DRAFT" : s(r.so_no) === gate.tempNo));
      // the intent before the insert (its time bounds the drafts a later run may take as this one's)
      if (draft && !("S1I" in gate.done)) steps.push(soCommitStep(gate, "S1I", gate.dbNow));
      out.draftSince = draft ? ("S1I" in gate.done ? gate.draftSince : gate.dbNow) : gate.draftSince;
      if (!already) {
        // a new SO: one insert of the whole document. A Draft: 'draft' + the issue rule (numbered on insert); else the
        // temporary number (S0N gives it its own)
        const row = soCommitFull({}, H.set, soCommitAddCols());
        row.so_no = draft ? "draft" : gate.tempNo;
        row.so_no_type = draft ? n0.so_no_type : -9999;
        row.is_processing = 1;
        row.table_so = soCommitTree(partRows);
        out.insertRows = [row];
        out.needInsert = "YES";
      }
    }
  }
  out.tempNo = gate.tempNo;
  // S0N: decided from the stored record (classic decides from the client's previous_status, which goes stale)
  if (!("S0N" in gate.done)) {
    const n = H.number || {};
    let need = false;
    let placeholder = "";
    let rule = "";
    if (edit) {
      need = s(n.stored_so_status) === "Draft" && s(H.saveAs) === "Issued" && s(n.stored_so_no_type) !== "-9999" && s(n.stored_so_no_type) !== "";
      placeholder = "issued";
      rule = s(n.stored_so_no_type);
    } else if (out.draftInsert === "YES" || (s(H.saveAs) === "Draft" && s(n.so_no_type) !== "-9999" && s(n.so_no_type) !== "")) {
      // a new Draft: numbered by its insert; S0N only records the number it reads back
      need = false;
      placeholder = "draft";
      rule = s(n.so_no_type);
    } else if (s(n.so_no_type) === "-9999") {
      // the number the user typed (classic keeps it): written over the temporary one
      need = true;
      placeholder = s(n.so_no);
      rule = "-9999";
    } else {
      need = true;
      placeholder = s(H.saveAs) === "Draft" ? "draft" : "issued";
      rule = s(n.so_no_type);
    }
    const before = edit ? s(n.stored_so_no) : gate.tempNo;
    // a run killed after the write and before its read-back: the SO already carries its new number -> adopt it, never
    // write the placeholder twice (each write issues a number: classic's double-submit burn)
    const cur = stored ? s(stored.so_no) : "";
    if (need && cur && cur !== before && (rule === "-9999" ? cur === placeholder : cur !== placeholder)) need = false;
    out.numberPlan = { need: need ? "YES" : "NO", placeholder: placeholder, rule: rule, manual: rule === "-9999" ? "YES" : "NO", before: before };
  }
  out.stepRows = steps;
  out.needSteps = steps.length ? "YES" : "NO";
  if (!out.jobRows.length) out.jobRows = [soCommitJobRow(gate, {})];
  return out;
};

// the new SO's table_so from the plan's inserts (parents with their children), as classic's add node writes it
const soCommitTree = function soCommitTree(partRows) {
  const ops = [];
  for (const r of list(partRows)) if (s(r.step_name).indexOf("L|") === 0) for (const o of list(soParse(r.result_ref))) ops.push(o);
  const tops = [];
  const byKey = {};
  for (const o of ops.filter((x) => x.op === "I")) {
    const row = Object.assign({}, o.row);
    if (!o.parent) {
      byKey[o.key] = row;
      tops.push(row);
    } else if (byKey[o.parent]) (byKey[o.parent].children = byKey[o.parent].children || []).push(row);
  }
  return tops;
};

// Phase A, node 2 (after the insert / header write): the new SO found by its number -> its lock row, the job naming it,
// S1 DONE; then the S0N write (the placeholder + the rule) and its intent.
const soCommitA2 = function soCommitA2(gate, a, foundRows) {
  const out = { route: "A2", soId: gate.soId, stepRows: [], needSteps: "NO", lockRows: [], needLock: "NO", jobRows: [], needJob: "NO", numberRows: [], needNumber: "NO", message: "" };
  if (gate.isEdit !== "YES" && !("S1" in gate.done)) {
    let f;
    if (a.draftInsert === "YES") {
      // a new Draft has no number of its own yet to find it by: exactly one candidate of this job, else review
      const c = list(foundRows).filter((r) => s(r.kind) === "DRAFT" && (!s(r.lock_ref) || s(r.lock_ref) === gate.idemKey));
      if (c.length > 1) return Object.assign(out, { route: "REVIEW", message: "several new drafts match this save: check them before saving again" });
      f = c[0];
    } else f = list(foundRows).find((r) => s(r.so_no) === gate.tempNo);
    if (!f || !digits(f.id)) return Object.assign(out, { route: "REVIEW", message: "the new sales order did not read back" });
    out.soId = s(f.id);
    // its lock row once (a run killed after writing it finds it here)
    if (s(f.lock_ref) && s(f.lock_ref) !== gate.idemKey) return Object.assign(out, { route: "REVIEW", message: "the new sales order is locked by another job" });
    if (s(f.lock_ref) !== gate.idemKey) {
      out.lockRows = [{ job_id: "SOS|" + out.soId, organization_id: gate.organizationId, step_name: "LOCK|1", step_status: "LOCK", attempt_count: 0, started_at: gate.dbNow, result_ref: gate.idemKey }];
      out.needLock = "YES";
    }
    out.jobRows = [{ id: gate.jobId, correlation_id: "SO|" + out.soId, source_so_ids: JSON.stringify([out.soId]), source_so_no: s(f.so_no) }];
    out.needJob = "YES";
    out.stepRows.push(soCommitStep(gate, "S1", { soId: out.soId }));
  }
  const np = a.numberPlan || {};
  if (np.need === "YES" && out.soId !== "0") {
    out.numberRows = [{ id: out.soId, so_no: np.placeholder, so_no_type: np.rule }];
    out.needNumber = "YES";
  }
  out.needSteps = out.stepRows.length ? "YES" : "NO";
  return out;
};

// Phase A, node 3: the number read back. A new number -> S0N DONE (it rides in the DONE row); the placeholder still
// there, or the number before it -> REQUIRES_REVIEW.
const soCommitA3 = function soCommitA3(gate, a, a2, numRows) {
  const out = { route: "A3", code: "200", message: "", reason: "", stepRows: [], needSteps: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], cancelHolds: [], needCancel: "NO", soNo: "" };
  if (a2.route === "REVIEW") return soCommitStop(gate, out, "REQUIRES_REVIEW", "SOV2_READBACK", a2.message);
  const np = a.numberPlan || {};
  const n = list(numRows)[0] || {};
  out.soNo = s(n.so_no);
  if ("S0N" in gate.done) return out;
  if (np.need === "YES") {
    // the user's number reads back as written; a numbered one is neither the placeholder nor the number before
    const ok = np.manual === "YES" ? out.soNo === np.placeholder : !!out.soNo && out.soNo !== np.placeholder && out.soNo !== np.before;
    if (!ok) return soCommitStop(gate, out, "REQUIRES_REVIEW", "SOV2_NUMBER", "the document number did not read back");
  }
  out.stepRows = [soCommitStep(gate, "S0N", { soNo: out.soNo })];
  out.needSteps = "YES";
  out.jobRows = [soCommitJobRow(gate, { progress_percent: 50, progress_message: gate.lParts.length && gate.isEdit === "YES" ? "Saving the lines" : "Finishing" })];
  out.message = "S0N " + out.soNo;
  return out;
};

// Phase B, node 1: one plan part's line ops. Updates as whole rows (the stored values, the plan's cells over them),
// removals is_deleted = 1, then the parents to insert; a line this job already inserted (on the SO, not in the plan's
// storedLineIds, the same line_index) is not inserted again.
const soCommitB = function soCommitB(gate, partRows, storedData, blankRows) {
  const out = { route: "B", code: "200", message: "", reason: "", updRows: [], needUpd: "NO", delRows: [], needDel: "NO", parentRows: [], needParents: "NO", jobRows: [], needUnlock: "NO",
    unlockRows: [], cancelHolds: [], needCancel: "NO", storedIdsSql: "0", ops: 0 };
  const H = soCommitPart(partRows, "H|000") || {};
  const ops = list(soCommitPart(partRows, gate.lPart));
  const stored = soCommitStoredRec(storedData);
  if (!stored) return soCommitStop(gate, out, "REQUIRES_REVIEW", "SOV2_NO_SO", "the sales order could not be read");
  const lines = {};
  for (const r of soFlatLines(stored.table_so)) if (s(r.id)) lines[s(r.id)] = r;
  const known = {};
  for (const id of list(H.storedLineIds)) known[String(id)] = true;
  out.storedIdsSql = list(H.storedLineIds).length ? list(H.storedLineIds).join(",") : "0";
  const mine = {};
  for (const id of Object.keys(lines)) if (!known[id]) mine[s(lines[id].line_index)] = id;
  const updCols = soCommitLineUpdCols();
  const addCols = soCommitLineAddCols();
  const blanks = soCommitBlanks(blankRows);
  for (const o of ops) {
    if (o.op === "U") {
      const was = lines[s(o.id)];
      if (!was) return soCommitStop(gate, out, "REQUIRES_REVIEW", "SOV2_LINE", "line " + o.id + " is gone");
      out.updRows.push(Object.assign({ id: s(o.id) }, soCommitFull(was, o.set, updCols, blanks[s(o.id)])));
    } else if (o.op === "D") {
      if (lines[s(o.id)]) out.delRows.push({ id: s(o.id), is_deleted: 1 });
    } else if (o.op === "I" && !o.parent) {
      if (mine[s(o.row.line_index)]) continue;
      out.parentRows.push(Object.assign(soCommitFull({}, o.row, addCols), { sales_order_id: gate.soId, parent_id: null }));
    }
  }
  out.ops = ops.length;
  out.needUpd = out.updRows.length ? "YES" : "NO";
  out.needDel = out.delRows.length ? "YES" : "NO";
  out.needParents = out.parentRows.length ? "YES" : "NO";
  return out;
};

// Phase B, node 2: the children to insert, each under its parent's id (an existing line, or a parent this job inserted:
// found among the SO's new lines by its line_index).
const soCommitB2 = function soCommitB2(gate, partRows, newRows) {
  const out = { route: "B2", childRows: [], needChildren: "NO", message: "" };
  const ops = list(soCommitPart(partRows, gate.lPart));
  const byIndex = {};
  for (const r of list(newRows)) byIndex[s(r.line_index)] = s(r.id);
  const keyIndex = {};
  for (const o of ops) if (o.op === "I" && !o.parent) keyIndex[o.key] = s(o.row.line_index);
  // a parent inserted in an earlier part: its key "N<i>" is its line_index i
  const parentId = (ref) => (digits(ref) ? ref : byIndex[keyIndex[ref] || ref.replace(/^N/, "")] || "");
  const addCols = soCommitLineAddCols();
  for (const o of ops) {
    if (o.op !== "I" || !o.parent) continue;
    if (byIndex[s(o.row.line_index)]) continue;
    const pid = parentId(s(o.parent));
    if (!pid) return Object.assign(out, { route: "REVIEW", message: "the parent of line " + s(o.row.line_index) + " did not read back" });
    out.childRows.push(Object.assign(soCommitFull({}, o.row, addCols), { sales_order_id: gate.soId, parent_id: pid }));
  }
  out.needChildren = out.childRows.length ? "YES" : "NO";
  return out;
};

// Phase B, node 3: every insert of the part reads back -> its DONE row; else REQUIRES_REVIEW.
const soCommitB3 = function soCommitB3(gate, partRows, b2, newRows) {
  const out = { route: "B3", code: "200", message: "", reason: "", stepRows: [], needSteps: "NO", jobRows: [], needUnlock: "NO", unlockRows: [], cancelHolds: [], needCancel: "NO" };
  if (b2.route === "REVIEW") return soCommitStop(gate, out, "REQUIRES_REVIEW", "SOV2_READBACK", b2.message);
  const ops = list(soCommitPart(partRows, gate.lPart));
  const byIndex = {};
  for (const r of list(newRows)) byIndex[s(r.line_index)] = s(r.id);
  const missing = ops.filter((o) => o.op === "I" && !byIndex[s(o.row.line_index)]);
  if (missing.length) return soCommitStop(gate, out, "REQUIRES_REVIEW", "SOV2_READBACK", "line " + s(missing[0].row.line_index) + " did not read back");
  out.stepRows = [soCommitStep(gate, "S2|" + gate.lPart.slice(2), { ops: ops.length })];
  out.needSteps = "YES";
  const k = gate.lParts.indexOf(gate.lPart) + 1;
  out.jobRows = [soCommitJobRow(gate, { progress_percent: 50 + Math.floor((40 * k) / Math.max(1, gate.lParts.length)), progress_message: "Saving the lines (" + k + " of " + gate.lParts.length + ")" })];
  return out;
};

// Phase C, node 1: what is left of S3 / S4 / S5 (each behind its DONE row) and the inputs of classic's after-steps.
// storedData: the SO as saved (classic code_node_9wKKlXUI's soData).
const soCommitC = function soCommitC(gate, partRows, storedData) {
  const A = soCommitPart(partRows, "A|000") || {};
  const so = soCommitStoredRec(storedData) || {};
  const d = gate.done;
  const ro = A.reorder || {};
  const sqt = list(A.sqtId).map(String).filter((x) => digits(x));
  return {
    route: "C", soData: so, soId: gate.soId, holds: "S3" in d ? [] : gate.holds, needRelease: !("S3" in d) && gate.holds.length ? "YES" : "NO",
    needUnlock: "S4" in d ? "NO" : "YES", unlockRows: [{ id: gate.soId, is_processing: 0 }],
    needReorder: !("S5R" in d) && num(ro.run) === 1 && (list(ro.prev).length || list(ro.latest).length) ? "YES" : "NO", reorderPrev: list(ro.prev), reorderLatest: list(ro.latest),
    needItemDate: !("S5I" in d) && list(A.itemIds).length ? "YES" : "NO", itemIds: list(A.itemIds),
    needSqt: !("S5Q" in d) && sqt.length ? "YES" : "NO", sqtRows: sqt.map((id) => ({ id: id, sqt_status: "Completed" })),
    needPost: !("S5P" in d) && s(so.so_status) === "Issued" ? "YES" : "NO", releaseOp: "RELEASE", cascadeRef: gate.cascadeRef, organizationId: gate.organizationId,
    stepS3: [soCommitStep(gate, "S3")], stepS4: [soCommitStep(gate, "S4")], stepS5R: [soCommitStep(gate, "S5R")], stepS5I: [soCommitStep(gate, "S5I")], stepS5Q: [soCommitStep(gate, "S5Q")],
    stepS5P: [soCommitStep(gate, "S5P")],
  };
};

// Phase C, node 2: the job COMPLETED with classic's answer (code_node_xtWJshxF's data), or REQUIRES_REVIEW when a hold
// did not release (the SO is saved; that delivery is not).
const soCommitDone = function soCommitDone(gate, c, releaseResults) {
  const out = { route: "DONE", code: "200", message: "Saved", reason: "", jobRows: [], stepRows: [], needSteps: "NO", needUnlock: "NO", unlockRows: [], cancelHolds: [], needCancel: "NO" };
  const rel = list(releaseResults);
  const bad = rel.filter((r) => s(r.route) !== "RELEASED");
  if (c.needRelease === "YES" && (bad.length || rel.length !== c.holds.length)) {
    return soCommitStop(gate, out, "REQUIRES_REVIEW", "SOV2_RELEASE", "the sales order is saved, but the change to delivery " + s((bad[0] || {}).gd_id) + " did not release");
  }
  const so = c.soData || {};
  // classic code_node_xtWJshxF: the deliveries' put-back notes joined; the released edits (the form commits them and
  // reports the ones that did not complete, as classic's code_node_GdeNotes); every hold of the job, also on a resume
  const notes = gate.holds.map((h) => s(h.note)).filter((n) => n);
  const result = { so_id: s(so.id || gate.soId), so_no: s(so.so_no), si_id: null, si_no: null, pickingReversalNote: notes.length ? notes.join("<br><br>") : null,
    gdEditJobs: gate.holds.map((h) => s(h.job_id)).filter((x) => digits(x)), gdEditDocs: gate.holds.map((h) => ({ job_id: s(h.job_id), gd_no: s(h.gd_no) || s(h.gd_id) })),
    gdEditNotes: [] };
  out.jobRows = [soCommitJobRow(gate, { job_status: "COMPLETED", progress_percent: 100, progress_message: "Saved", error_details: JSON.stringify(result), finished_at: gate.dbNow })];
  out.message = "Saved " + result.so_no;
  return out;
};

const soCommitResult = function soCommitResult(guard, gate, src) {
  const g = gate || {};
  const r = src || {};
  const jr = list(r.jobRows)[0];
  return { route: s(r.route), code: s(r.code), message: s(r.message), reason: s(r.reason), job_id: s(g.jobId || guard.jobIdSql), job_status: jr ? s(jr.job_status) : "",
    phase: s(g.phase), so_id: s(g.soId), evidence: JSON.stringify({ v: 1, workflow: "SO_SAVE_COMMIT", phase: s(g.phase), route: s(r.route), code: s(r.code), reason: s(r.reason) }) };
};

// ---- this node
const res = soCommitA2([{{node:code_node_SCgate.data}}][0], [{{node:code_node_SCa.data}}][0], [{{node:sql_node_SCfind2.data}}][0]);
console.log("so commit a2", JSON.stringify({ route: res.route, so: res.soId, number: res.needNumber }));
return res;