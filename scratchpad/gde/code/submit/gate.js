// GD_EDIT_SUBMIT - Gate: the edit as a delta against the GD as stored, what the background save does not handle (the classic
// save takes it; refused above 500 lines), then GOODS_DELIVERY's gates in its order on the edited data (chain_edit.js,
// gates only): 401, the started-Picking 400, Full Picking, the fill-back 400s, the Picking reconcile (busy / invoiced /
// packing 400, the reversal 413), the required fields. The credit limit and the quantity 400s are post.js's (that order).
const submitGateOn = function submitGateOn(guard, entry, R, form, K) {
  const base = { route: "STOP", code: "", message: "", reason: "", needCL: "not required", clAutoOverride: "0", customer: null, total: null, qtyStop: "", delta: null,
    pickingId: "", pickingReversalNote: "" };
  const n = num(entry.lineCount);
  const stored = R.stored;
  if (!stored) return Object.assign(base, answer("STOP", "400", "Goods Delivery not found"));
  let delta, allData;
  const fc = guard.source === "PICKING_FC";
  // a Picking force complete: its planned parts against the GD as stored (a line changed since its PREPARE stops it, 409)
  if (fc) {
    const d = fcDelta(stored, guard.fcParts);
    if (!d.ok) return Object.assign(base, answer("STOP", d.code, d.message));
    delta = d.delta;
    allData = geApplyDelta(stored, delta, K);
    allData.gd_status = stored.gd_status;
  // the cascade sends its payload (diffed as the form's) or a delta
  } else if (guard.source === "CASCADE" && guard.delta && Array.isArray(guard.delta.layout)) {
    delta = guard.delta;
    allData = geApplyDelta(stored, delta, K);
    allData.gd_status = stored.gd_status;
  } else {
    allData = form;
    delta = geDelta(form, stored, K, R.cfDefs);
  }
  const rows = (allData.table_gd || []).flatMap((r) => [r].concat(r.children || []));
  if ((R.serialItems || []).length) return Object.assign(base, notEligible("it has serial-numbered items", n));
  if (Object.prototype.hasOwnProperty.call(delta.header || {}, "plant_id") || (delta.dropHeader || []).indexOf("plant_id") >= 0) return Object.assign(base, notEligible("its plant changes", n));
  if (Number(allData.is_select_picking || stored.is_select_picking || 0) === 1 || rows.some((r) => s(r.line_pp_id) || s(r.pp_line_item_id))) return Object.assign(base, notEligible("it was created from a Picking Plan", n));
  const setup = ((R.pickingSetup || {}).data) || {};
  if (Number(setup.is_loading_bay) === 1) return Object.assign(base, notEligible("its organisation uses a loading bay", n));
  // the force complete closes its own Picking: other Pickings of the GD are its PREPARE's concern (refused there when open)
  if (!fc && (R.livePickings || []).length > 1) return Object.assign(base, notEligible("more than one Picking names it", n));
  const pk = ((R.pick || {}).data) || {};
  if (!fc && s(pk.id)) {
    let gdNo = pk.gd_no;
    if (typeof gdNo === "string") { try { gdNo = JSON.parse(gdNo); } catch (e) { gdNo = [gdNo]; } }
    const others = (Array.isArray(gdNo) ? gdNo : [gdNo]).map((x) => s(x)).filter((x) => x && x !== s(stored.id));
    if (others.length || (pk.table_picking_items || []).some((r) => s(r.gd_id) && s(r.gd_id) !== s(stored.id))) return Object.assign(base, notEligible("its Picking is shared with other deliveries", n));
  }
  const a = guard.answers || {};
  // the force complete's re-save is classic PICKING's (code_node_GdPlan: isPicking Yes, no loading bay) without its credit check:
  // the edit only decreases ("auto" still checks where full_cl_check = 1 and fails a hard Block)
  const params = fc ? { allData, saveAs: "Created", pageStatus: "Edit", needCL: "not required", continueZero: "Yes", confirmPickReversal: "", isPicking: "Yes", isLoadingBay: 0 }
    : guard.source === "CASCADE"
    ? { allData, saveAs: "Created", pageStatus: "Edit", needCL: "auto", continueZero: "Yes", confirmPickReversal: s(a.confirmPickReversal) }
    : { allData, saveAs: "Created", pageStatus: "Edit", needCL: s(a.needCL) || "required", continueZero: s(a.continueZero), confirmPickReversal: s(a.confirmPickReversal), auto_gr_confirmed: "", auto_gr_skip: "" };
  const out = geChain({ params, reads: R, stored, tenantId: s(entry.tenantId), uuid: "GES" + s(entry.gdId), kinds: K, gatesOnly: true, extraReads: R.extraReads,
    checkRequired: (data, fields) => gsRequired(typeof data === "string" ? data : JSON.stringify(data), typeof fields === "string" ? fields : JSON.stringify(fields)) });
  if (out.route === "NOT_ELIGIBLE") return Object.assign(base, notEligible(out.message, n));
  if (out.route !== "GATES") return Object.assign(base, answer("STOP", out.code, out.message));
  const fill = __withContext(out.ctx.head, () => __v("node:code_node_IyJHrBst.data.allData")) || {};
  return Object.assign(base, answer("GO", "", ""), {
    needCL: s(out.needCL) || "not required", clAutoOverride: s(out.clAutoOverride) || "0", customer: fill.customer_name === undefined ? null : fill.customer_name,
    total: fill.gd_total === undefined ? null : fill.gd_total, qtyStop: s(out.qtyStop), delta: delta, pickingId: fc ? "" : s(pk.id), pickingReversalNote: s(out.pickingReversalNote),
  });
};
// a Picking whose device lock is stale (entry.staleLocks): the lifted reconcile reads it released, as PREPARE reads our own lock
const gsUnstale = function gsUnstale(R, stale) {
  const ids = (Array.isArray(stale) ? stale : []).map(String);
  const p = (R.pick || {}).data;
  if (p && p.id !== undefined && ids.indexOf(String(p.id)) >= 0) p.is_processing = 0;
  return R;
};
const submitGate = function submitGate(guard, entry, S, form, K) {
  const g = guard.source === "PICKING_FC" ? Object.assign({}, guard, { fcParts: fcParts((S || {}).fcPartRows) }) : guard;
  const R = gsUnstale(geAdapt(S), entry.staleLocks);
  R.uomNames = gcRows((S || {}).uoms).map((r) => gcParse(r.j));
  return submitGateOn(g, entry, R, form, K);
};
