// GD_COMPLETE_SUBMIT - Gate: the stored GD (PREPARE's reads + adapter), then what PREPARE would refuse, then GOODS_DELIVERY's
// gates up to CHECK_REQUIRED_FIELD in its order (chain.js gatesOnly). The credit limit and the gates after it are post.js's.
// FORM: the form's data must equal the stored GD in every column the classic save writes, else it goes to the classic save;
// the one exception is gd_undelivered_qty, which the form recomputes on open and is carried over as the classic save would.
const gsFlat = (rows) => (Array.isArray(rows) ? rows : []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
// written onto the lines by pick confirmations, never by the user: a form opened before the latest pick is not an edit
const GS_PICKING_COLS = { picking_status: 1, prev_temp_qty_data: 1, picked_qty: 1, picked_temp_qty_data: 1, picked_view_stock: 1 };
const gsFormDiff = function gsFormDiff(form, stored, kinds) {
  const H = kinds.header, L = kinds.line;
  const norm = (v, k) => {
    const x = gcColValue(v, k);
    return x === undefined ? null : typeof x === "object" ? JSON.stringify(x) : x;
  };
  const eq = (a, b) =>
    (a === null && b === null) ||
    (a !== null && b !== null && (typeof a === "number" || typeof b === "number" ? Math.abs(Number(a) - Number(b)) < 1e-9 : String(a) === String(b)));
  const changed = [];
  for (const c of GC_GD_WRITE_COLS) {
    if (!H[c] || !Object.prototype.hasOwnProperty.call(form, c)) continue;
    if (!eq(norm(form[c], H[c]), norm(stored[c], H[c]))) changed.push(c);
  }
  const byId = {};
  for (const r of gsFlat(stored.table_gd)) byId[String(r.id)] = r;
  const overrides = {};
  let added = 0, matched = 0;
  for (const r of gsFlat(form.table_gd)) {
    const o = byId[String(r.id)];
    if (!o) {
      added++;
      continue;
    }
    matched++;
    for (const c of Object.keys(r)) {
      if (c === "children" || c === "id" || !L[c] || GS_PICKING_COLS[c]) continue;
      if (eq(norm(r[c], L[c]), norm(o[c], L[c]))) continue;
      if (c === "gd_undelivered_qty") overrides[String(r.id)] = { gd_undelivered_qty: r[c] === null || r[c] === "" ? 0 : r[c] };
      else if (changed.indexOf("table_gd." + c) < 0) changed.push("table_gd." + c);
    }
  }
  const removed = Object.keys(byId).length - matched;
  if (added) changed.push(added + " new line(s)");
  if (removed) changed.push(removed + " removed line(s)");
  return { changed: changed, overrides: overrides };
};
// what GD_COMPLETE_PREPARE refuses, read off the stored lines (its planner is not run here)
const gsStructural = function gsStructural(R, stored) {
  if ((R.serialItems || []).length) return "it has serial-numbered items";
  if (parseFloat(stored.is_select_picking || 0) === 1) return "it was created from a Picking Plan";
  const arr = (t) => {
    if (!t) return [];
    if (Array.isArray(t)) return t;
    try {
      const a = JSON.parse(t);
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  };
  // the classic save stamps the Picking a line is linked to (GD_UNUSED_FN_NEW Branch 4)
  for (const r of gsFlat(stored.table_gd).filter((x) => x.material_id)) {
    if ((digits(r.line_to_id) && s(r.line_to_id) !== "0") || arr(r.temp_qty_data).concat(arr(r.prev_temp_qty_data)).some((t) => t && s(t.picking_record_id))) return "it is linked to a Picking";
  }
  return "";
};
const submitGate = function submitGate(guard, entry, S, form) {
  const n = num(entry.lineCount);
  const base = { route: "STOP", code: "", message: "", reason: "", needCL: "not required", clAutoOverride: "0", customer: null, total: null, post: {}, overrides: {} };
  const R = gcAdapt(S);
  if (!R.gd.count) return Object.assign(base, answer("STOP", "400", "Goods Delivery not found"));
  const stored = R.gd.data;
  let overrides = {};
  if (guard.source === "FORM") {
    if (!form || typeof form !== "object" || !Array.isArray(form.table_gd)) return Object.assign(base, notEligible("the form's data was not sent", n));
    const d = gsFormDiff(form, stored, GC_KINDS);
    if (d.changed.length) return Object.assign(base, notEligible("it has unsaved changes (" + d.changed.slice(0, 6).join(", ") + (d.changed.length > 6 ? ", ..." : "") + ")", n, true));
    overrides = d.overrides;
  }
  const why = gsStructural(R, stored);
  if (why) return Object.assign(base, notEligible(why, n));
  const out = gcChain({ params: gcParams(stored, guard.answers, guard.source, overrides), reads: R, tenantId: guard.tenantId, uuid: "GDS" + guard.gdId, kinds: GC_KINDS, gatesOnly: true });
  if (out.route === "NOT_ELIGIBLE") return Object.assign(base, notEligible(out.message, n));
  if (out.route !== "GATES") return Object.assign(base, answer("STOP", out.code, out.message));
  const g = out.gates;
  if (num(g.needSOCleanUp) === 1) return Object.assign(base, notEligible("lines were removed from it", n));
  // if_KTzHecEc
  const req = gsRequired(g.eidData, g.eidFields);
  if (req.status === "Failed") return Object.assign(base, answer("STOP", "400", req.message));
  return Object.assign(base, answer("GO", "", ""), {
    needCL: g.needCL, clAutoOverride: g.clAutoOverride, customer: g.customer, total: g.total, overrides: overrides,
    post: {
      pickingRequired: g.pickingRequired, skipPicking: g.skipPicking, fillPickingStatus: g.fillPickingStatus, rollupPickingStatus: g.rollupPickingStatus,
      packingSetups: g.packingSetups, packingStatus: g.packingStatus, itemNotFound: g.itemNotFound, soLineMissing: g.soLineMissing,
      soLineMissingMessage: g.soLineMissingMessage, validationMessage: g.validationMessage, siConfirm: g.siConfirm, siMsg: g.siMsg,
    },
  });
};
