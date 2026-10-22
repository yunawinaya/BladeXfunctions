// Small Cycle IA SO-line projection (scratchpad/iasc/CONTRACT.md section 6): pure, ES2015
const spS = (v) => (v === undefined || v === null ? "" : String(v)).trim();
const spNum = (v) => {
  const x = parseFloat(v);
  return isFinite(x) ? x : 0;
};
const spQ8 = (v) => Number((parseFloat(v) || 0).toFixed(8));
// JSON text with 16+ digit integer tokens kept as strings (ids never become floats); objects pass through
const spParseJ = (v) => {
  if (v && typeof v === "object") return v;
  const t = spS(v);
  if (!t) return null;
  try {
    return JSON.parse(t.replace(/"(?:[^"\\]|\\.)*"|(^\s*|[:\[,]\s*)(-?\d{16,})(?=\s*(?:[,\]}]|$))/g, (m, pre, num) => (num === undefined ? m : pre + '"' + num + '"')));
  } catch (e) {
    return null;
  }
};
// sql-node rows carrying one JSON column `j` (text or object) -> objects
const spRows = (rows) => (Array.isArray(rows) ? rows : rows ? [rows] : []).map((r) => (r && r.j !== undefined ? spParseJ(r.j) : null)).filter((x) => x && typeof x === "object");
const spConvs = (it) => {
  let c = it && it.table_uom_conversion;
  if (typeof c === "string") c = spParseJ(c);
  return (Array.isArray(c) ? c : []).filter((x) => x && typeof x === "object");
};
// factor to the FG's base UOM ("alt_qty alt = base_qty base"); null when unknown, never 1:1
const spToBase = (fg, uom) => {
  const u = spS(uom);
  if (!fg) return null;
  if (!u || u === spS(fg.based_uom)) return 1;
  const c = spConvs(fg).filter((x) => spS(x.alt_uom_id) === u)[0];
  if (!c) return null;
  const a = spNum(c.alt_qty);
  const b = spNum(c.base_qty);
  return a > 0 && b > 0 ? b / a : null;
};
// a Created IA (RES-01, BA 10-22) is open production like a Draft
const SP_OPEN = { Draft: 1, Created: 1, Processing: 1, Issued: 1 };
const SP_DONE = { Completed: 1, "Fully Posted": 1 };
// a Cancelled IA (user 10-22) is no production at all: not counted, nothing to warn about
const SP_VOID = { Cancelled: 1 };

const scProject = (input) => {
  const inp = input || {};
  const line = inp.line || null;
  const header = inp.header || null;
  const fg = inp.fg || null;
  const uomName = typeof inp.uomName === "function" ? inp.uomName : (id) => id;
  const warnings = [];
  const warn = (code, text) => warnings.push({ code: code, text: text });
  const soNo = spS(header && header.so_no) || "the Sales Order";
  const where = soNo + (line && spS(line.line_index) ? " line " + spS(line.line_index) : "");
  const lineLive = !!line && Number(line.is_deleted) !== 1;
  const headLive = !!header && Number(header.is_deleted) !== 1;
  const lineUom = spS(line && line.so_item_uom) || spS(fg && fg.based_uom);
  const conv = (qty, fromUom) => {
    const from = spS(fromUom) || spS(fg && fg.based_uom);
    if (from === lineUom) return spNum(qty);
    const a = spToBase(fg, from);
    const b = spToBase(fg, lineUom);
    return a === null || b === null ? null : (spNum(qty) * a) / b;
  };
  const ordered = lineLive ? spNum(line.so_quantity) : 0;
  const delivered = lineLive ? spNum(line.delivered_qty) : 0;
  let complete = true;
  let planned = 0;
  let produced = 0;
  let open = 0;
  const ias = (Array.isArray(inp.ias) ? inp.ias : []).map((x) => {
    const status = spS(x.status);
    const id = spS(x.id);
    const row = { id: id, no: spS(x.no), status: status, role: "none", qty: null, itemQty: spQ8(x.item_qty), uomId: spS(x.item_uom),
      planned: spQ8(spS(x.planned_output_qty) ? x.planned_output_qty : x.item_qty), mode: spS(x.mode) };
    if (Number(x.is_deleted) === 1 || SP_VOID[status]) return row;
    if (!SP_OPEN[status] && !SP_DONE[status]) {
      warn("IA_STATUS_UNKNOWN", "Item Assembly " + row.no + " has status " + (status || "(blank)") + ", so it is not counted.");
      return row;
    }
    const qty = conv(x.item_qty, x.item_uom);
    const plan = conv(spS(x.planned_output_qty) ? x.planned_output_qty : x.item_qty, x.item_uom);
    if (qty === null || plan === null) {
      complete = false;
      warn("UNCONVERTIBLE", "Item Assembly " + row.no + " is in " + uomName(spS(x.item_uom)) + ", which cannot be converted to " + uomName(lineUom)
        + ": the figures are incomplete.");
      return row;
    }
    row.qty = spQ8(qty);
    planned += plan;
    if (SP_DONE[status]) {
      row.role = "produced";
      produced += qty;
    } else if (id && id === spS(inp.excludeIaId)) {
      row.role = "excluded";
    } else {
      row.role = "open";
      open += qty;
    }
    return row;
  });
  const headStatus = spS(header && header.so_status);
  const lineStatus = spS(line && line.line_status);
  if (!headLive) warn("SO_REMOVED", "The linked Sales Order no longer exists.");
  else if (headStatus === "Cancelled") warn("SO_CANCELLED", soNo + " is cancelled: it has no remaining demand.");
  else if (headStatus === "Void") warn("SO_VOID", soNo + " is void: it has no remaining demand.");
  else if (headStatus === "Completed") warn("SO_CLOSED", soNo + " is completed: it has no remaining demand.");
  else if (headStatus === "Draft") warn("SO_DRAFT", soNo + " is still a Draft.");
  else if (headStatus !== "Issued" && headStatus !== "Processing") warn("SO_INACTIVE", soNo + " has status " + (headStatus || "(blank)") + ": it has no active demand.");
  if (!lineLive) warn("LINE_REMOVED", "The linked line of " + soNo + " no longer exists (it was removed or re-created): re-link this Item Assembly to a current line.");
  else if (lineStatus === "Completed") warn("LINE_COMPLETED", where + " is completed.");
  else if (lineStatus === "Cancelled") warn("LINE_CANCELLED", where + " is cancelled.");
  const itemMismatch = lineLive && spS(inp.iaItemId) && spS(line.item_name) !== spS(inp.iaItemId);
  if (itemMismatch) warn("ITEM_CHANGED", where + " is for a different item than this Item Assembly.");
  const base = inp.baseline && typeof inp.baseline === "object" ? inp.baseline : null;
  if (base && lineLive) {
    if (spS(base.uomId) && spS(base.uomId) !== lineUom) warn("UOM_CHANGED", where + " changed its unit from " + uomName(spS(base.uomId)) + " to " + uomName(lineUom) + " since it was linked.");
    else if (spNum(base.orderedQty) > ordered + 1e-9) warn("REDUCED", where + " was reduced from " + spQ8(base.orderedQty) + " to " + spQ8(ordered) + " " + uomName(lineUom) + " since it was linked.");
  }
  const active = lineLive && headLive && (headStatus === "Issued" || headStatus === "Processing") && lineStatus !== "Completed" && lineStatus !== "Cancelled";
  // nothing records which delivery came from which IA: when both delivered and produced are above 0 they may overlap, so the
  // remaining demand lies between ordered - delivered - produced - open (no overlap) and ordered - max(delivered, produced) - open
  const overlap = Math.min(delivered, produced) > 0;
  let excess = 0;
  if (inp.proposal && complete) {
    const p = conv(inp.proposal.qty, inp.proposal.uomId);
    if (p === null) complete = false;
    else if (active) excess = spQ8(Math.max(0, Math.max(delivered, produced) + open + p - ordered));
  }
  // with an unknown overlap the excess is only a lower bound
  if (excess > 0) warn("EXCESS", "This plan exceeds the remaining demand of " + where + " by " + (overlap ? "at least " : "") + excess + " " + uomName(lineUom) + "; you can still continue.");
  let reason = "";
  if (!headLive || !lineLive) reason = "The Sales Order line no longer exists.";
  else if (spS(inp.iaOrgId) && spS(header.organization_id) !== spS(inp.iaOrgId)) reason = soNo + " belongs to another organisation.";
  else if (!active) reason = where + " has no active demand (" + (headStatus || "no status") + (lineStatus ? " / " + lineStatus : "") + ").";
  else if (itemMismatch) reason = where + " is for a different item.";
  const lo = spQ8(Math.max(0, ordered - delivered - produced - open));
  const hi = spQ8(Math.max(0, ordered - Math.max(delivered, produced) - open));
  // exact only when both bounds agree; an inactive line has no demand (a genuine 0)
  const unavailable = !complete ? "UNCONVERTIBLE" : active && lo !== hi ? "OVERLAP" : "";
  const suggestion = unavailable ? null : active ? hi : 0;
  return { ok: true, code: "", message: "", eligibleNew: !reason, reason: reason, uomId: lineUom,
    totals: { ordered: spQ8(ordered), delivered: spQ8(delivered), undelivered: spQ8(Math.max(ordered - delivered, 0)), planned: spQ8(planned),
      produced: spQ8(produced), open: spQ8(open), openOthers: spQ8(open), suggestion: suggestion, unavailable: unavailable, excess: excess,
      excessExact: !overlap, complete: complete },
    ias: ias, warnings: warnings, candidates: Array.isArray(inp.candidates) ? inp.candidates : [] };
};
// CANDIDATES: the eligible lines for a new link, each with its own suggestion
const scCandidates = (input) => {
  const inp = input || {};
  const all = Array.isArray(inp.ias) ? inp.ias : [];
  const out = [];
  (Array.isArray(inp.rows) ? inp.rows : []).forEach((row) => {
    const lineId = spS(row && row.line && row.line.id);
    const p = scProject({ line: row.line, header: row.header, fg: inp.fg, ias: all.filter((x) => spS(x.source_so_line_id) === lineId),
      iaItemId: inp.iaItemId, iaOrgId: inp.iaOrgId, uomName: inp.uomName });
    if (!p.eligibleNew) return;
    out.push({ lineId: lineId, soId: spS(row.header && row.header.id), soNo: spS(row.header && row.header.so_no), lineIndex: spS(row.line.line_index),
      customerId: spS(row.header && row.header.customer_id), customerName: spS(row.header && row.header.customer_name), uomId: p.uomId,
      ordered: p.totals.ordered, delivered: p.totals.delivered, undelivered: p.totals.undelivered, suggestion: p.totals.suggestion });
  });
  return out;
};
if (typeof module !== "undefined") module.exports = { spS, spNum, spQ8, spParseJ, spRows, spToBase, scProject, scCandidates };
