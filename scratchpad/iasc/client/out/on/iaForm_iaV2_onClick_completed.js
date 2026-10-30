// Small Cycle (scratchpad/iasc): RES-01 - after a completion the form closes the IA's holds (IA_HOLD CLOSE: what the completion issued
// from Reserved delivered, the rest released), in the background: IA_SAVE / IA V2 never run it (a crash inside would fail them after the
// stock moved; user 10-21). Only an IA that reserves, whatever the switch (it only makes holds; review I4); opening a completed IA that still
// holds stock starts it again.
const RES_HOLD = "2112752274794217473"; // IA_HOLD
const resCloseAfter = (saved, data) => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const raw = saved && saved.id;
  const id = s(Array.isArray(raw) ? raw[0] : raw) || s(data && data.id);
  if (!/^[1-9][0-9]{0,19}$/.test(RES_HOLD) || !/^[0-9]{1,20}$/.test(id) || !/^[0-9]{1,20}$/.test(s(data && data.organization_id))) return;
  // a new IA completed at once never held anything
  if (s(data.page_status) !== "Edit" || !s(data.material_hold_status)) return;
  try {
    const p = this.runWorkflow(RES_HOLD, { ia_id: id, organization_id: s(data.organization_id), operation: "CLOSE", source: "COMPLETE" }, () => {},
      (e) => console.error("RES-01: closing the holds failed", e));
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    console.error("RES-01: closing the holds could not be started", e);
  }
};
// -- end Small Cycle --
// iaV2_onClick_completed - Item Assembly form, onClick of button_completed. One source for the Completed and the Complete & Post
// buttons; each knows its classic handler as a constant (rollback = bind the button back to it).
// IA V2: a completion of more than IA_V2_MIN_PICKS stock picks (temp_qty_data entries with sm_quantity > 0) without handling
// units or serial numbers goes to IA_V2_SUBMIT; Complete & Post posts with the classic posting code once the job is COMPLETED.
// Everything else - the switch or this action off, Revert V2 off, a workflow id not set, a View page, a stored status other than Draft,
// <= IA_V2_MIN_PICKS picks, handling units, serial numbers, a NOT_ELIGIBLE or INVALID answer, any error before SUBMIT is
// called - runs the classic handler through triggerEvent, unchanged.
const IA_WF = {
  SUBMIT: "2112141238600376321", // IA_V2_SUBMIT
  WORKER: "2112141277456408577", // IA_V2_WORKER
  REVERT_SUBMIT: "2112141384234999809", // IA_REVERT_V2_SUBMIT
  REVERT_WORKER: "2112141417890095105", // IA_REVERT_V2_WORKER
};
// Switch: false = every click runs the classic handler and nothing else
const ASYNC_IA_ENABLED = true;
// the list's Revert V2 switch: a background completion only while it is on too (CONTRACT ruling 9)
const ASYNC_IA_REVERT_ENABLED = true;
// Per action, false = the classic handler. With COMPLETE_POST off, a big Complete & Post still completes in the background
// (when COMPLETE is on) and is posted from the list.
const IA_V2_ACTIONS = { COMPLETE: true, COMPLETE_POST: true };
// the classic handler this button ran before, and whether this button posts
const IA_CLASSIC = "onClick_saveAsCompleted";
const IA_BUTTON_POSTS = false;
const IA_POLL_MS = 2500;
const IA_KICK_MS = 15000;
const IA_WAIT_MS = 420000;
const IA_LINK_POLL_MS = 3000;
const IA_LINK_WAIT_MS = 90000;
const IA_KICK_MAX = 10;
const IA_RUNNING = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA"];
const IA_TERMINAL = ["COMPLETED", "FAILED", "REQUIRES_REVIEW", "CANCELLED"];
// not record fields: the job's own fields, the stock dialog, buttons, badges, layout widgets, platform keys
const IA_NOT_RECORD = ["ia_v2_job_id", "ia_idem_key", "_data", "$_v", "_vts", "isTrusted", "sm_item_balance", "button_draft",
  "button_completed", "comp_post_button", "button_post", "draft_status", "issued_status", "completed_status", "fullyposted_status",
  "processing_status", "flex_2det1nd2", "flex_t6y2yh5r", "item_assembly_tittle", "sc_section", "sc_collapse", "sc_info", "sc_info_so", "sc_info_ordered", "sc_info_produced", "sc_info_open", "sc_info_suggest", "sc_info_cover", "sc_info_bom", "sc_info_warn", "sc_info_customer", "sc_info_delivered", "sc_info_over", "sc_actions", "sc_btn_line", "sc_btn_unlink", "sc_btn_relink", "sc_btn_suggest", "sc_btn_bom", "sc_btn_refresh", "sc_line_dialog", "sc_expand_dialog", "sc_sec_production", "sc_prod_grid", "sc_sec_output", "sc_output_grid", "sc_sec_more", "sc_more_grid", "sc_actual", "sc_prod_actions", "output_split_sum", "output_split_pick", "output_split_count", "output_split_btn", "tr_section", "tr_collapse", "tr_info", "tr_pick", "tr_storage_location_id", "tr_location_id", "tr_required_date", "tr_actions", "tr_btn_create", "tr_btn_view", "tr_btn_refresh", "tr_btn_cancel", "tr_btn_new", "tr_btn_replace", "tr_btn_defect", "tr_defect_dialog", "tr_defect_note", "tr_defect_table"];

// IA V2 shared helpers (CONTRACT.md section 6): every name ia / IA_-prefixed so it concatenates with a step's own helpers
const iaS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
// 16+ digit integer tokens stay strings (never a float's fraction digits)
const iaParseJ = (t) => {
  if (t === undefined || t === null) return null;
  if (typeof t === "object") return t;
  try {
    return JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
const iaList = (x) => (Array.isArray(x) ? x : x ? [x] : []).filter((r) => r !== undefined && r !== null);
const iaJsonList = (v) => {
  if (Array.isArray(v)) return v;
  const t = iaS(v);
  if (!t) return [];
  const p = iaParseJ(t);
  return Array.isArray(p) ? p : [];
};
// code_issue_line's filter: sm_quantity > 0, array order; unparseable = none
const iaPicks = (line) => iaJsonList(line && line.temp_qty_data).filter((p) => p && typeof p === "object" && (parseFloat(p.sm_quantity) || 0) > 0);
const iaPickCount = (lines) => iaList(lines).reduce((n, l) => n + iaPicks(l).length, 0);
const iaLineHasHu = (line) => iaJsonList(line && line.temp_qty_data).some((p) => p && typeof p === "object" && iaS(p.handling_unit_id) !== "")
  || iaJsonList(line && line.temp_hu_data).length > 0;
const IA_V2_MIN_PICKS = 50;
const IA_TEXT = {
  busy: "This Item Assembly is being processed in the background - please wait for it to finish.",
  underReview: "Its last completion stopped half-way and is under review: please contact support.",
  stale: (status) => "This Item Assembly was changed by someone else (it is now " + (iaS(status) || "without a status") + "). Please close it and open it again.",
  alreadyFinal: (status) => "This Item Assembly is already " + iaS(status) + ".",
  classicFinal: (status) => "This Item Assembly is already " + iaS(status) + " and cannot be saved again.",
  classicTooBig: (n, cap) => "This Item Assembly has " + n + " stock picks; this save can process at most " + cap + " at once. Split it into smaller assemblies, or complete it from the web form if background completion is switched on.",
  tooBig: (n, reason, cap) => "This Item Assembly has " + n + " stock picks and cannot be completed in the background (" + iaS(reason) + "); the classic save handles at most " + cap + " picks.",
  splitRequired: (n) => "This Item Assembly has " + n + " stock picks. At most 5,000 can be issued at once - please split the assembly.",
  queueFailed: "The completion could not be queued: please try again.",
  notLocked: "The Item Assembly is no longer locked by this completion: nothing was moved.",
  linesChanged: "The Item Assembly's lines changed while it was waiting: nothing was moved, please complete it again.",
  lockBusy: "The stock of its components stayed locked by another operation: nothing was moved, please try again later.",
  review: "Under review: the completion stopped half-way. Please contact support.",
  prevUnknown: "Under review: the status to restore is unknown. Please contact support.",
  batchDuplicate: "Duplicate Batch Format found.",
  postLater: "Still completing in the background; post it from the list once it shows Completed.",
  rvConflicts: "Revert blocked: the assembled item has been used or its stock has moved on.",
  rvDone: "Item Assembly reverted to Draft successfully.",
  rvClassicTooBig: (n, cap) => "This Item Assembly has " + n + " stock rows; this revert can process at most " + cap + " at once. Revert it from the Item Assembly list if background revert is switched on, or contact support.",
  rvTooBig: (n, reason, cap) => "This Item Assembly has " + n + " stock movements to take back and cannot be reverted in the background (" + iaS(reason) + "); the classic revert handles at most " + cap + ".",
  rvSplitRequired: (n) => "This Item Assembly has " + n + " stock movements to take back. At most 5,000 can be reverted at once.",
  // the revert's own wording of the completion texts above (CONTRACT ruling 9)
  rvNotLocked: "The Item Assembly is no longer locked by this revert: nothing was reverted.",
  rvReview: "Under review: the revert stopped half-way. Please contact support.",
  rvUnderReview: "Its last revert stopped half-way and is under review: please contact support.",
  rvQueueFailed: "The revert could not be queued: please try again.",
  rvNotReverted: "Temporary failures persisted; not reverted.",
  rvNoJob: "no background revert",
};

const iaOn = () => ASYNC_IA_ENABLED === true && ASYNC_IA_REVERT_ENABLED === true &&
  [IA_WF.SUBMIT, IA_WF.WORKER, IA_WF.REVERT_SUBMIT, IA_WF.REVERT_WORKER].every((id) => /^[1-9][0-9]{0,19}$/.test(id));
// COMPLETE for the Completed button; COMPLETE_POST (or, when it is off, COMPLETE) for Complete & Post
const modeOf = () => {
  if (!IA_BUTTON_POSTS) return IA_V2_ACTIONS.COMPLETE === true ? "COMPLETE" : "";
  if (IA_V2_ACTIONS.COMPLETE_POST === true) return "POST";
  return IA_V2_ACTIONS.COMPLETE === true ? "POST_LATER" : "";
};

const s = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const digits = (v) => /^[0-9]{1,20}$/.test(s(v));
// a job's Item Assembly: SUBMIT answers "" (or "0") until the job is linked to the assembly it saved
const linked = (v) => /^[1-9][0-9]{0,19}$/.test(s(v));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const data_ = () => this.models["_data"] || {};
const store = (patch) => {
  this.models["_data"] = { ...this.models["_data"], ...patch };
};

const release = () => {
  store({ ia_submitting: 0 });
  this.hideLoading();
};
// a click that claimed the form but never showed the loading (the classic route, a Cancel at the BOM check)
const unclaim = () => store({ ia_submitting: 0 });

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
  }
};

const refreshList = () => {
  if (this.parentGenerateForm) this.parentGenerateForm.refresh();
};

// settles on the callback or on the promise runWorkflow returns, whichever comes first
const run = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });

// an alert closed with its X rejects: it was still read
const alertBox = (message, title, type) =>
  this.$alert(message, title || "", { confirmButtonText: "OK", type: type, dangerouslyUseHTMLString: false }).catch(() => {});

const markSeen = (jobId) => {
  try {
    localStorage.setItem("ia_v2_failed_seen_" + s(jobId), "1");
  } catch (e) {}
};

// the classic handler, exactly as the button ran it before (once per click)
let handedOver = false;
let touched = false;
const classic = async (why) => {
  if (handedOver) return;
  handedOver = true;
  console.log("Item Assembly V2: classic handler -", why);
  if (touched) release();
  else unclaim();
  try {
    await this.triggerEvent(IA_CLASSIC);
  } catch (e) {
    console.error("Item Assembly V2: classic handler failed", e);
  }
};

// The BOM seeds the component table but does not bind it, so the two can legitimately
// differ by completion. This reports the difference once and never blocks the save.
const scBaseConfirmBomVariance = async (data) => {
  if (!data.item_id) return true;

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  const bomRes = await db
    .collection("bill_of_materials")
    .where({
      parent_material_code: data.item_id,
      organization_id: organizationId,
      is_deleted: 0,
      is_active: 1,
    })
    .get()
    .catch(() => ({ data: [] }));

  const boms = bomRes.data || [];
  if (boms.length === 0) return true;

  // Same selection rule as the explosion: default wins, otherwise highest V-number.
  const versionOf = (bom) => {
    const match = /^V(\d+)$/.exec(
      String(bom.parent_mat_bom_version || "").trim(),
    );
    return match ? parseInt(match[1], 10) : 0;
  };
  boms.sort((a, b) => {
    const byDefault =
      (b.parent_mat_is_default === 1 ? 1 : 0) -
      (a.parent_mat_is_default === 1 ? 1 : 0);
    return byDefault !== 0 ? byDefault : versionOf(b) - versionOf(a);
  });
  const bom = boms[0];

  const bomSubs = (bom.subform_sub_material || []).filter(
    (sub) => sub.bom_material_code && sub.consume_type !== "REF",
  );
  const bomItems = new Set(bomSubs.map((sub) => String(sub.bom_material_code)));

  const lines = data.stock_movement || [];
  const lineItems = new Set(lines.map((line) => String(line.item_selection)));

  const differences = [];

  lines.forEach((line) => {
    const label = line.item_name || line.item_selection;
    const allocated = parseFloat(line.total_quantity) || 0;
    const required = parseFloat(line.requested_qty) || 0;

    if (!bomItems.has(String(line.item_selection))) {
      differences.push(`Added: ${label} (${allocated})`);
    } else if (Math.abs(allocated - required) > 0.0005) {
      differences.push(`Changed: ${label} ${required} \u2192 ${allocated}`);
    }
  });

  bomSubs.forEach((sub) => {
    if (!lineItems.has(String(sub.bom_material_code))) {
      differences.push(
        `Removed: ${sub.sub_material_name || sub.bom_material_code}`,
      );
    }
  });

  if (differences.length === 0) return true;

  return this.$confirm(
    `These components differ from BOM ${bom.parent_mat_bom_version}:<br><br>` +
      differences.map((line) => `\u2022 ${line}`).join("<br>") +
      "<br><br>Complete the assembly with these components?",
    "Components Differ From The BOM",
    {
      confirmButtonText: "Complete",
      cancelButtonText: "Cancel",
      dangerouslyUseHTMLString: true,
      type: "warning",
    },
  ).then(
    () => true,
    () => false,
  );
};

// Small Cycle (scratchpad/iasc): an Item Assembly holding a BOM snapshot is compared with that snapshot at item_qty instead of
// the latest BOM (reference vs actual, lines not built from it, its rows without a line) and the linked Sales Order line's
// warnings are listed (never blocking; a failed read says the figures are unavailable). A Flat line of an expanded
// sub-assembly, or references out of step with item_qty, stop the completion. Anything else: the v36 check above, unchanged.
const SC_ENABLED = true;
const SC_WF_PROJECTION = "2112448183267332097"; // SO_IA_PROJECTION
const SC_WF_RELINK = "2112448260018900994"; // IA_SC_RELINK
const scS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const scNum = (v) => {
  const x = parseFloat(v);
  return isFinite(x) ? x : 0;
};
const scQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
const scParseJ = (v) => {
  if (v && typeof v === "object") return v;
  const t = scS(v);
  if (!t) return null;
  try {
    return JSON.parse(t.replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
const scChain = (s0, steps) => {
  let s = s0;
  let r = 0;
  for (let i = 0; i < steps.length; i++) {
    r = s * scNum(steps[i][0]) * (1 + scNum(steps[i][1]) / 100);
    if (i < steps.length - 1) s = r * scNum(steps[i][2]);
  }
  return r;
};
const scRowQty = (amount, serial) => {
  const q = scQ8(amount);
  return serial ? Math.ceil(q) : q;
};
const scSnapOf = (snapshot) => {
  const s = scParseJ(snapshot);
  if (!s || s.v !== 1 || (s.mode !== "STANDARD" && s.mode !== "FLAT") || !s.root || !scS(s.root.bomId) || !Array.isArray(s.rows)) return null;
  const okRow = (r) => r && scS(r.key) && scS(r.itemId) && Array.isArray(r.paths) && r.paths.every((p) => p && Array.isArray(p.steps) && p.steps.length > 0);
  return s.rows.every(okRow) && scNum(s.root.baseQty) > 0 ? s : null;
};
const scRecompute = (snapshot, outputQty) => {
  const s = scSnapOf(snapshot);
  if (!s) return [];
  const s0 = (scNum(outputQty) * scNum(s.root.conv || "1")) / scNum(s.root.baseQty);
  return s.rows.map((r) => ({ key: scS(r.key), itemId: scS(r.itemId), uomId: scS(r.uomId),
    qty: scRowQty(r.paths.reduce((sum, p) => sum + scChain(s0, p.steps), 0), Number(r.serial) === 1) }));
};
const scVarHtml = (t) => scS(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const scVarRun = (id, params) =>
  new Promise((resolve, reject) => {
    const p = this.runWorkflow(id, params, (res) => resolve(res), (err) => reject(err));
    if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
  });
// the linked line's warnings now: a list, or null when the figures could not be read
const scVarWarnings = async (data) => {
  let org = scS(data.organization_id);
  if (!org) {
    org = this.getVarGlobal("deptParentId");
    if (org === "0") org = this.getVarSystem("deptIds").split(",")[0];
  }
  try {
    const res = await scVarRun(SC_WF_PROJECTION, { operation: "SUMMARY", so_id: scS(data.source_so_id), so_line_id: scS(data.source_so_line_id),
      item_id: scS(data.item_id), exclude_ia_id: scS(data.page_status) === "Edit" && /^[0-9]{1,20}$/.test(scS(data.id)) ? scS(data.id) : "",
      organization_id: scS(org), proposal_qty: scQ8(data.item_qty) > 0 ? scQ8(data.item_qty).toFixed(8) : "", proposal_uom_id: scS(data.item_uom),
      baseline: scS(data.source_so_context_json) });
    const d = (res && res.data) || {};
    const r = scS(d.code) === "200" ? scParseJ(d.result_json) : null;
    if (!r || !Array.isArray(r.warnings)) return null;
    // the projection names units by id: shown by name (when the names cannot be read, by id)
    const ids = [scS(data.item_uom), scS(r.uomId)].filter((id, i, all) => id && all.indexOf(id) === i);
    const names = {};
    try {
      const u = ids.length ? await db.collection("unit_of_measurement").field("uom_name")
        .filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: ids }, { prop: "is_deleted", operator: "equal", value: 0 }] }])
        .limit(ids.length).get() : { data: [] };
      ((u && u.data) || []).forEach((x) => (names[scS(x.id)] = scS(x.uom_name)));
    } catch (e) {}
    return r.warnings.map((w) => Object.keys(names).reduce((t, id) => (names[id] ? t.split(id).join(names[id]) : t), scS(w && w.text))).filter((t) => t);
  } catch (e) {
    console.error("Small Cycle: the Sales Order figures could not be read", e);
    return null;
  }
};
const confirmBomVariance = async (data) => {
  const mode = scS(data.bom_consumption_mode);
  const ready = SC_ENABLED === true && /^[1-9][0-9]{0,19}$/.test(SC_WF_PROJECTION) && /^[1-9][0-9]{0,19}$/.test(SC_WF_RELINK);
  const snap = ready && (mode === "STANDARD" || mode === "FLAT") && scS(data.bom_snapshot_json) ? scSnapOf(data.bom_snapshot_json) : null;
  if (!snap) return scBaseConfirmBomVariance(data);
  const lines = Array.isArray(data.stock_movement) ? data.stock_movement : [];
  const label = (l) => scS(l.item_name) || scS(l.item_selection);
  if (snap.mode === "FLAT") {
    const expanded = {};
    (snap.expand || []).forEach((id) => {
      expanded[scS(id)] = 1;
    });
    const hit = lines.filter((l) => expanded[scS(l.item_selection)] && scNum(l.total_quantity) > 0)[0];
    if (hit) {
      await this.$alert(scVarHtml(label(hit)) + " is expanded into its components in Flat mode, so it cannot also be consumed: remove its line or prepare the BOM again without it.",
        "Cannot Complete", { confirmButtonText: "OK", type: "error" }).catch(() => {});
      return false;
    }
  }
  const refs = {};
  scRecompute(snap, data.item_qty).forEach((x) => {
    refs[x.key] = x;
  });
  const differences = [];
  const seen = {};
  const stale = [];
  lines.forEach((l) => {
    const x = refs[scS(l.sc_ref_key)];
    const actual = scQ8(l.total_quantity);
    if (x && x.itemId === scS(l.item_selection) && x.uomId === scS(l.quantity_uom)) {
      seen[x.key] = 1;
      if (Math.abs(scNum(l.requested_qty) - x.qty) > 0.0005) stale.push(label(l));
      if (Math.abs(actual - x.qty) > 0.0005) differences.push("Changed: " + label(l) + " " + x.qty + " → " + actual);
    } else {
      differences.push("Added: " + label(l) + " (" + actual + ")");
    }
  });
  if (stale.length) {
    await this.$alert("The reference quantities of " + scVarHtml(stale.slice(0, 5).join(", ")) + (stale.length > 5 ? " and " + (stale.length - 5) + " more" : "")
      + " do not match the quantity " + scQ8(data.item_qty) + ": change the quantity again or press Prepare BOM, then complete again.", "Cannot Complete",
      { confirmButtonText: "OK", type: "error" }).catch(() => {});
    return false;
  }
  snap.rows.forEach((r) => {
    if (!seen[scS(r.key)]) differences.push("Removed: " + (scS(r.name) || scS(r.itemId)));
  });
  const warnings = /^[0-9]{1,20}$/.test(scS(data.source_so_line_id)) ? await scVarWarnings(data) : [];
  if (!differences.length && warnings && !warnings.length) return true;
  const parts = [];
  if (differences.length) {
    parts.push("These components differ from the prepared BOM (" + (snap.mode === "FLAT" ? "Flat" : "Standard") + ", " + scVarHtml(snap.root.version) + ", for "
      + scQ8(data.item_qty) + "):<br><br>" + differences.map((d) => "• " + scVarHtml(d)).join("<br>"));
  }
  if (warnings === null) parts.push("The Sales Order figures are unavailable right now, so its warnings could not be checked.");
  else if (warnings.length) parts.push("Sales Order:<br>" + warnings.map((w) => "• " + scVarHtml(w)).join("<br>"));
  return this.$confirm(parts.join("<br><br>") + "<br><br>Complete the assembly?", differences.length ? "Components Differ From The Prepared BOM" : "Check Before Completing", {
    confirmButtonText: "Complete",
    cancelButtonText: "Cancel",
    dangerouslyUseHTMLString: true,
    type: "warning",
  }).then(
    () => true,
    () => false,
  );
};
// -- end Small Cycle --


// the classic Complete & Post's posting code, verbatim (base onClick_saveAsCompletedPost): run on a COMPLETED job only
const iaClassicPost = (() => {
// The accounting agent task queue shared by all V2 post functions.
const AGENT_TASK_WORKFLOW_ID = "2013511169625042946";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const postToAccounting = async (stockMovementId, organizationId) => {
  const resAI = await db
    .collection("accounting_integration")
    .where({ organization_id: organizationId })
    .get();
  const aiData = resAI.data[0];

  switch (aiData.acc_integration_type) {
    case "SQL Accounting V2":
    case "AutoCount Accounting V2":
      await db
        .collection("sm_item_assembly")
        .doc(stockMovementId)
        .update({ posted_status: "Pending Post" });

      this.$message.success("Item Assembly completed successfully.");
      closeDialog();
      await this.runWorkflow(
        AGENT_TASK_WORKFLOW_ID,
        {
          agent_id: aiData.agent_id,
          task_type: "post_item_assembly",
          payload: [stockMovementId],
          priority: "0",
        },
        async (res) => {
          console.log("成功结果：", res);
        },
        (err) => {
          console.log("失败结果：", err);
        },
      );
      break;

    default:
      // No post handler for this integration type, so posted_status is left
      // alone rather than stranded at Pending Post. The save still went through.
      console.log(
        "No post handler for accounting integration type:",
        aiData.acc_integration_type,
      );
      this.$message.success("Item Assembly completed successfully.");
      closeDialog();
      break;
  }
};

return postToAccounting;
})();

// the classic Complete & Post's organization for the post
const postOrg = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

// the route of this click (CONTRACT section 12), or why it stays with the classic handler
const routeOf = (v) => {
  const page = s(v.page_status);
  const isNew = page === "Add" || page === "Clone" || page === "Copy";
  if (!isNew && page !== "Edit") return { why: "page " + (page || "unknown") };
  if (!isNew && !digits(v.id)) return { why: "no document id" };
  if (!isNew && s(v.item_assembly_status) !== "Draft" && s(v.item_assembly_status) !== "Created") return { why: "stored " + (s(v.item_assembly_status) || "no status") };
  const lines = Array.isArray(v.stock_movement) ? v.stock_movement : [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || {};
    if (iaLineHasHu(line)) return { why: "handling units on line " + (i + 1) };
    if (iaPicks(line).some((p) => s(p.serial_number) !== "")) return { why: "serial numbers on line " + (i + 1) };
  }
  const picks = iaPickCount(lines);
  if (picks <= IA_V2_MIN_PICKS) return { why: picks + " picks" };
  return { isNew: isNew, page: page, picks: picks };
};

const canon = (v) => {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
};
const hash16 = (text) => {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  const hex = (x) => ("00000000" + x.toString(16)).slice(-8);
  return hex(h1) + hex(h2);
};

const orgOf = (record) => {
  const own = s(record.organization_id);
  if (own) return own;
  let org = this.getVarGlobal("deptParentId");
  if (org === "0") org = this.getVarSystem("deptIds").split(",")[0];
  return s(org);
};

// one key per content: a lost answer re-sent with the same key finds the same job; new content or a FAILED job gets the next
// generation (a new key, a new job). Both buttons send the same content, so one key serves Completed and Complete & Post.
// After an answer that leaves it open whether anything was written (no answer, STOP 500, the platform's error envelope), or
// while a new assembly's job is not linked yet, the next click re-uses the key whatever the content.
const pinSlot = (ctx) => (ctx.isNew ? "ia_pinned_new" : "ia_pinned_edit");
const idemKey = (ctx) => {
  const pinned = s(data_()[pinSlot(ctx)]);
  if (pinned) return pinned;
  let token = s(data_().ia_page_token);
  if (!token) {
    token = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store({ ia_page_token: token });
  }
  const doc = ctx.isNew ? "new-" + token : s(ctx.record.id);
  const hash = hash16(canon({ saveAs: "Completed", pageStatus: ctx.page, record: ctx.record }));
  return ("IA:" + ctx.org + ":" + doc + ":" + hash + ":" + ctx.gen).replace(/[^A-Za-z0-9|:_.-]/g, "-").slice(0, 128);
};
const pin = (ctx, on) => store({ [pinSlot(ctx)]: on ? ctx.key : "" });
// a new assembly that SUBMIT may have saved: Save as Draft would add a second one (the Completed buttons re-send the key)
const keepKey = (ctx) => {
  pin(ctx, true);
  if (ctx.isNew) this.hide(["button_draft", "button_created"]);
};

// CONTRACT section 7: every request key is sent (strings except form)
const request = (ctx, operation, iaId) => ({
  operation: operation,
  saveAs: "Completed",
  pageStatus: operation === "STATUS" ? "Edit" : ctx.page,
  ia_id: s(iaId),
  idempotency_key: ctx.key,
  source: "FORM",
  form: operation === "STATUS" ? {} : ctx.record,
});

// the text of the platform's error envelope ({ code 400, data null, msg }), unwrapped from 执行工作流节点[<node>]报错[<text>];
// a transport error has none
const envelopeText = (x) => {
  let raw = "";
  if (typeof x === "string") raw = s(x);
  else if (x && typeof x === "object") {
    const env = x instanceof Error ? (x.response && x.response.data) || {} : x;
    const inner = env.data && typeof env.data === "object" ? env.data : {};
    raw = s(env.msg) || s(inner.msg) || s(inner.message) || (x instanceof Error ? "" : s(env.message));
  }
  const m = raw.match(/报错\[([\s\S]*)\]\s*$/);
  return m ? s(m[1]) : raw;
};

const nameOf = (ctx, r) => ("Item Assembly " + (s(r && r.ia_no) || s(ctx.record.stock_movement_no))).trim();

const statusOf = (w, jobId) => {
  if (!w) return "";
  if (s(w.job_id) === s(jobId)) return s(w.job_status);
  const jobs = iaJsonList(w.jobs);
  const mine = jobs.find((j) => j && s(j.job_id) === s(jobId));
  return mine ? s(mine.job_status) : "";
};

const kick = (jobId) => {
  try {
    const p = this.runWorkflow(IA_WF.WORKER, { job_id: s(jobId) }, () => {}, (e) => console.error("Item Assembly V2: worker start failed", e));
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) {
    console.error("Item Assembly V2: worker could not be started", e);
  }
};

// after the stock moved: the worker finishes the job (at most IA_KICK_MAX calls); the form is closed by then
const kickLoop = async (job, name) => {
  for (let n = 1; n <= IA_KICK_MAX; n++) {
    let w = null;
    try {
      const res = await run(IA_WF.WORKER, { job_id: s(job.jobId) });
      w = (res && res.data) || null;
    } catch (e) {
      console.error("Item Assembly V2: worker call failed - the list starts it again", e);
    }
    const st = statusOf(w, job.jobId);
    if (IA_TERMINAL.indexOf(st) >= 0) {
      refreshList();
      if (st === "COMPLETED") return;
      markSeen(job.jobId);
      await alertBox("It stopped half-way and is under review: please contact support. " + s(w && w.result_message), name + " needs a review", "warning");
      return;
    }
    if (Number((w && w.processed) || 0) > 0) refreshList();
    else await sleep(3000);
  }
};

const finish = (job, text, moving, name) => {
  release();
  store({ ia_page_token: null, ia_gen: 1 });
  this.$message.success(text);
  closeDialog();
  if (moving) kickLoop(job, name);
};

// Complete & Post on a COMPLETED job: the classic posting code, unchanged
// a job is posted once (another tab following it never posts it again), and only while the stored assembly is Completed and
// unposted (the form Post's rule)
const iaPostOnce = async (job) => {
  try {
    if (localStorage.getItem("ia_v2_posted_" + s(job.jobId))) return false;
    localStorage.setItem("ia_v2_posted_" + s(job.jobId), "1");
  } catch (e) {}
  const res = await db.collection("sm_item_assembly").where({ id: job.iaId, is_deleted: 0 }).field("item_assembly_status,posted_status").get();
  const key = (v) => String((v && typeof v === "object" ? v.dict_key : v) || "").trim();
  const row = (res && res.data && res.data[0]) || null;
  return !!row && key(row.item_assembly_status) === "Completed" && ["Unposted", "Failed Post", ""].indexOf(key(row.posted_status)) >= 0;
};

const postCompleted = async (job) => {
  release();
  store({ ia_page_token: null, ia_gen: 1 });
  try {
    if (!(await iaPostOnce(job))) {
      this.$message.success("Item Assembly completed; it is already posted or being posted.");
      closeDialog();
      return;
    }
    await iaClassicPost(job.iaId, postOrg());
  } catch (e) {
    console.error("Item Assembly V2: posting could not be started", e);
    this.$message.warning("Item Assembly completed, but posting could not be started. Please post it from the Item Assembly list.");
    closeDialog();
  }
};

const completedText = (ctx, name) =>
  ctx.mode === "COMPLETE" ? name + " completed." : name + " completed. Post it from the Item Assembly list.";

// wait for the verdict: a terminal job, or (Completed button) the stock moved (COMMITTING_IA at 80 %); Complete & Post waits
// for COMPLETED and posts then
const follow = async (ctx, q) => {
  const name = nameOf(ctx, q);
  const job = { jobId: s(q.job_id), iaId: linked(q.ia_id) ? s(q.ia_id) : s(ctx.record.id) };
  this.showLoading("Completing " + name + "...");
  kick(job.jobId);
  let kickedAt = Date.now();
  let parkKicked = false;
  const deadline = Date.now() + IA_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(IA_POLL_MS);
    if (Date.now() - kickedAt >= IA_KICK_MS) {
      kickedAt = Date.now();
      kick(job.jobId);
    }
    let st = null;
    try {
      const res = await run(IA_WF.SUBMIT, request(ctx, "STATUS", job.iaId));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Item Assembly V2: status check failed - trying again", e);
    }
    if (st && (s(st.job_status) === "NONE" || (s(st.terminal) === "YES" && !s(st.job_id)))) {
      // no job any more: the form is out of date - close it so the assembly is opened again from the list
      release();
      this.$message.warning(name + " is not being completed in the background any more. Open it again to see its current state.");
      closeDialog();
      return;
    }
    if (!st || s(st.job_id) !== job.jobId) continue;
    if (linked(st.ia_id)) job.iaId = s(st.ia_id);
    const js = s(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // nothing moved and the assembly is a Draft again: an edit keeps the form and its content; the next click is a new job
      release();
      store({ ia_gen: ctx.gen + 1 });
      markSeen(job.jobId);
      await alertBox(s(st.error_message) || s(st.error_code) || "The Item Assembly could not be completed.", name + " was not completed", "error");
      // a new assembly that failed is a saved Draft now: never stay in Add mode (a second click would save a second one)
      if (ctx.isNew) closeDialog();
      return;
    }
    if (js === "COMPLETED") {
      resCloseAfter({ id: job.iaId }, ctx.record);
      if (ctx.mode === "POST") return postCompleted(job);
      return finish(job, completedText(ctx, name), false, name);
    }
    if (js === "REQUIRES_REVIEW") {
      release();
      markSeen(job.jobId);
      await alertBox("It stopped half-way and is under review: please contact support. " + s(st.error_message), name + " needs a review", "warning");
      closeDialog();
      return;
    }
    if (ctx.mode !== "POST" && js === "COMMITTING_IA" && Number(st.progress_percent) >= 80) {
      const text = ctx.mode === "COMPLETE" ? name + ": the stock has moved; it is being finished in the background." : name + ": " + IA_TEXT.postLater;
      return finish(job, text, true, name);
    }
    // parked at 75 %: the components are issued and the receipt needs the next worker run (one stock call per run); start it now
    if (!parkKicked && js === "COMMITTING_IA" && Number(st.progress_percent) === 75) {
      parkKicked = true;
      kickedAt = Date.now();
      kick(job.jobId);
    }
  }
  release();
  if (ctx.mode === "COMPLETE") this.$message.info(name + " is still being completed in the background.");
  else this.$message.warning(name + ": " + IA_TEXT.postLater);
  closeDialog();
};

// a new assembly's job answered before SUBMIT linked it to its assembly (a same-key retry or a double click while the first
// SUBMIT still runs): the form stays and keeps the SAME key; STATUS of that key until the job shows its assembly
const awaitLink = async (ctx, q) => {
  keepKey(ctx);
  this.showLoading("Completing Item Assembly...");
  const deadline = Date.now() + IA_LINK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(IA_LINK_POLL_MS);
    let st = null;
    try {
      const res = await run(IA_WF.SUBMIT, request(ctx, "STATUS", "0"));
      st = (res && res.data) || null;
    } catch (e) {
      console.error("Item Assembly V2: status check failed - trying again", e);
    }
    if (!st || s(st.route) !== "STATUS") continue;
    const js = s(st.job_status);
    if (js === "FAILED" || js === "CANCELLED") {
      // the job ended without completing: tell why; the next click is a new job (a new key)
      pin(ctx, false);
      release();
      store({ ia_gen: ctx.gen + 1 });
      markSeen(st.job_id);
      await alertBox(s(st.error_message) || s(st.progress_message) || "The completion did not finish.", "Item Assembly was not completed", "error");
      // a failed new assembly that was linked is a saved Draft now: never stay in Add mode
      if (linked(st.ia_id)) closeDialog();
      return;
    }
    if (linked(st.ia_id) && (IA_RUNNING.indexOf(js) >= 0 || js === "COMPLETED" || js === "REQUIRES_REVIEW")) {
      pin(ctx, false);
      return queued(ctx, { ...q, ...st });
    }
    // no job of this key (NONE), or under review before it was linked: stop asking; the key stays for the next click
    if (js === "NONE" || js === "REQUIRES_REVIEW" || (s(st.terminal) === "YES" && !s(st.job_id))) break;
  }
  release();
  this.$message.warning("The completion is still being prepared - check the Item Assembly list before saving again.");
};

const queued = (ctx, r) => {
  if (ctx.isNew && !linked(r.ia_id)) return awaitLink(ctx, r);
  return follow(ctx, r);
};

const submit = async (ctx) => {
  this.showLoading("Completing Item Assembly...");
  const params = request(ctx, "SUBMIT", ctx.isNew ? "" : ctx.record.id);
  let res = null;
  let failure = null;
  try {
    res = await run(IA_WF.SUBMIT, params);
  } catch (e) {
    // the losing twin of the unique insert, a dropped connection: once more with the same key
    console.log("Item Assembly V2: submit failed, repeating once with the same key", e);
    try {
      res = await run(IA_WF.SUBMIT, params);
    } catch (again) {
      failure = again;
      console.error("Item Assembly V2: submit failed twice", again);
    }
  }
  const r = (res && res.data) || null;
  if (!r || !r.route) {
    // no answer, or the platform's error envelope (a refusal that ended the run before anything was written)
    release();
    keepKey(ctx);
    this.$message.error(envelopeText(failure) || envelopeText(res) || "No response from workflow. Please try again - the same completion is sent again.");
    return;
  }
  const message = s(r.message);
  const st = s(r.job_status);
  if (r.route === "STOP" && s(r.code) === "500") {
    release();
    keepKey(ctx);
    this.$message.error(message || IA_TEXT.queueFailed);
    return;
  }
  pin(ctx, false);
  if (r.route === "NOT_ELIGIBLE" || r.route === "INVALID") return classic(r.route + ": " + (s(r.reason) || message));
  if (r.route === "STATUS" && (st === "NONE" || !s(r.job_id))) {
    release();
    this.$message.warning(message || "No background completion was found for this Item Assembly. Please try again.");
    return;
  }
  if (r.route === "QUEUED" || (r.route === "STATUS" && IA_RUNNING.indexOf(st) >= 0)) return queued(ctx, r);
  if (r.route === "STATUS" && st === "COMPLETED") {
    // completed by an earlier click: never post twice from here
    release();
    this.$message.success(nameOf(ctx, r) + " is already completed." + (ctx.mode === "COMPLETE" ? "" : " Post it from the Item Assembly list if it is not posted yet."));
    closeDialog();
    return;
  }
  if (r.route === "STATUS" && (st === "FAILED" || st === "CANCELLED" || st === "REQUIRES_REVIEW")) {
    // the same content failed before: tell why; the next click tries again with a new key (a new assembly's job under review
    // before it was linked keeps its key: only that job can save it)
    release();
    if (st !== "REQUIRES_REVIEW") store({ ia_gen: ctx.gen + 1 });
    else if (ctx.isNew && !linked(r.ia_id)) keepKey(ctx);
    markSeen(r.job_id);
    await alertBox(s(r.error_message) || s(r.progress_message) || "The previous completion of this Item Assembly did not finish.", nameOf(ctx, r),
      st === "REQUIRES_REVIEW" ? "warning" : "error");
    // a failed new assembly is a saved Draft now: never stay in Add mode
    if (ctx.isNew && linked(r.ia_id)) closeDialog();
    return;
  }
  release();
  if (r.route === "BUSY" || r.route === "STALE") {
    this.$message.warning(message || IA_TEXT.busy);
    return;
  }
  this.$message.error(message || "Failed to save the Item Assembly");
};

(async () => {
  // switched off (or this action off, or a workflow id not set): the classic handler and nothing else
  const mode = modeOf();
  if (!iaOn() || !mode) return classic("switched off (ASYNC_IA_ENABLED / IA_V2_ACTIONS / ASYNC_IA_REVERT_ENABLED)");
  let submitting = false;
  try {
    if (data_().ia_submitting === 1) {
      this.$message.warning("Workflow is already in progress. Please wait.");
      return;
    }
    // claimed before the first await: a second click while this one validates or reads the BOM would follow the same job
    store({ ia_submitting: 1 });
    const values = this.getValues();
    const route = routeOf(values);
    if (route.why) return classic(route.why);
    // the classic's own checks first: a field error goes to the classic handler, which shows it; Cancel ends the click
    try {
      await this.validate();
    } catch (invalid) {
      return classic("validation");
    }
    const record = { ...values };
    IA_NOT_RECORD.forEach((k) => delete record[k]);
    Object.keys(record).forEach((k) => {
      if (k.indexOf("dialog_") === 0) delete record[k];
    });
    if (!(await confirmBomVariance(record))) return unclaim();
    const ctx = { mode: mode, isNew: route.isNew, page: route.page, record: record, org: orgOf(record), gen: Number(data_().ia_gen) || 1 };
    ctx.key = idemKey(ctx);
    touched = true;
    store({ ia_submitting: 1 });
    submitting = true;
    await submit(ctx);
  } catch (error) {
    if (!submitting) {
      console.error("Item Assembly V2: error before SUBMIT - classic handler", error);
      await classic("error before SUBMIT");
      return;
    }
    release();
    console.error("Item Assembly V2 error:", error);
    this.$message.error((error && error.message) || "Failed to save the Item Assembly");
  }
})();
