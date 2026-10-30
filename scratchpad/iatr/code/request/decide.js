// IA_TRANSFER_REQUEST - Decide (iatrDecide2 on the reads): an answer now (STATUS, a refusal, "already" / "existing"), or GO with our
// claim row (IATR|<ia> / CLAIM|<n>, HELD) and the write: the new request (CREATE / REPLACE: header + lines from the IA's reservation,
// numbered at the insert by the organisation's rule; a replacement linked to the received request), its new lines + fingerprint +
// revision (REFRESH), the defect (DEFECT: one engine operation per click, the reservation rows, the IA lines, the received request's
// log), or Cancelled (CANCEL: state only, no stock call); the audit log gains one entry; want = what the read-back must show
const trDecide = function trDecide(g, iaRead, reqRead, destRead, whoRead) {
  const s = iatrS;
  const A = trJ(iaRead);
  const Q = trJ(reqRead);
  const D = trJ(destRead);
  const W = trJ(whoRead);
  const uoms = {};
  for (const u of Array.isArray(A.uoms) ? A.uoms : []) if (u && s(u.item) && u.row) (uoms[iatrId(u.item)] = uoms[iatrId(u.item)] || []).push(u.row);
  const named = Q.named && typeof Q.named === "object" ? Q.named : null;
  const now = s(W.now);
  const user = s(W.user);
  const name = "CLAIM|" + ((parseInt(W.max, 10) || 0) + 1);
  const d = iatrDecide2({ op: g.op, ia: A.ia, iaLines: A.lines, items: A.items, uoms: uoms, holds: A.holds, reqs: Q.reqs, named: named, sl: D.sl, bin: D.bin, member: W.member,
    org: g.org, iaId: g.ia, rule: D.rule, expectFp: g.expectFp, storage: g.sl, binId: g.bin, requiredDate: g.requiredDate, setupRows: W.setup, defects: g.defects, now: now,
    logEntry: { by: user, uid: g.uid, claim: name }, uomNames: A.uomNames, binNames: A.binNames, batchNos: A.batchNos });
  const out = { route: d.route, code: d.code, message: d.message || "", result_json: JSON.stringify(d.result || {}), claimRows: [], claimName: "", isCreate: "NO",
    isRefresh: "NO", isDefect: "NO", isCancel: "NO", lot: {}, refresh: {}, cancel: {}, defect: {}, want: {}, relink: {} };
  if (d.route !== "GO") return out;
  const ia = A.ia;
  out.claimName = name;
  out.claimRows = [{ job_id: "IATR|" + g.ia, organization_id: g.org, step_name: name, step_status: "HELD", attempt_count: 1, started_at: now, finished_at: null,
    inventory_operation_id: "", result_ref: (g.key + "|" + g.op).slice(0, 250), error_code: "", error_message: "" }];
  const entry = { at: now, by: user, uid: g.uid, op: g.op, rev: d.rev || 0, fp: d.fp || "", lines: d.lines || 0, claim: name };
  if (g.op === "CREATE" || g.op === "REPLACE") {
    out.isCreate = "YES";
    out.lot = { stock_movement_status: "Requested", issuing_operation_faci: s(ia.plant), issue_date: g.requiredDate + " 00:00:00", stock_movement_no: "issued",
      stock_movement_no_type: s(D.rule), movement_type: "Location Transfer", movement_type_id: "", movement_reason: "", issued_by: user, reference_documents: null,
      organization_id: s(ia.org), project_id: null, is_production_order: 0, production_order_id: null, stock_movement: d.lineRows, remarks: "", remark: "", remark2: "",
      remark3: "", transfer_purpose: IATR_PURPOSE, source_ia_id: s(ia.id), source_ia_no: s(ia.no), source_ia_fp: d.fp, source_ia_rev: "1",
      required_date: g.requiredDate + " 00:00:00", requested_by: user, requested_at: now, replaces_id: d.replacesId, replacement_for_id: d.replacementForId,
      request_log: iatrLog("", Object.assign(entry, { skipped: d.skipped || [] })) };
    out.want = { lotId: "", status: "Requested", fp: d.fp, rev: "1", sources: d.lineRows.map((l) => s(l.source_ia_line_id)).sort() };
  } else if (g.op === "REFRESH") {
    out.isRefresh = "YES";
    out.refresh = { id: d.lotId, source_ia_fp: d.fp, source_ia_rev: String(d.rev), request_log: iatrLog(named.log, Object.assign(entry, { skipped: d.skipped || [] })),
      stock_movement: d.lineRows };
    out.want = { lotId: d.lotId, status: "Requested", fp: d.fp, rev: String(d.rev), sources: d.lineRows.map((l) => s(l.source_ia_line_id)).sort() };
  } else if (g.op === "DEFECT") {
    out.isDefect = "YES";
    // one engine operation per click: a retried click replays it, never moves the stock twice
    out.defect = { opKey: "IAD|" + iatrHash(g.key), movements: d.movements, holdRows: d.holdRows, iaRows: d.iaRows, logRow: d.logRow };
    out.want = { lotId: d.lotId, holds: d.holdRows.map((h) => ({ id: s(h.id), status: s(h.status), open_qty: s(h.open_qty) })),
      lines: d.iaRows.map((r) => ({ id: s(r.id), picks: iatrHash(s(r.temp_qty_data)) })) };
  } else {
    out.isCancel = "YES";
    out.cancel = { id: d.lotId, stock_movement_status: "Cancelled", lot_v2_job_id: "", request_log: iatrLog(named.log, entry) };
    out.want = { lotId: d.lotId, status: "Cancelled" };
    // a cancelled replacement gives the IA's link back to its received request (Done writes it)
    out.relink = d.relink || {};
  }
  return out;
};
const res = trDecide([{{node:code_node_TRguard.data}}][0], [{{node:sql_node_TRia.data}}][0], [{{node:sql_node_TRreq.data}}][0], [{{node:sql_node_TRdest.data}}][0],
  [{{node:sql_node_TRwho.data}}][0]);
console.log("request decide", JSON.stringify({ route: res.route, code: res.code, message: res.message, claim: res.claimName }));
return res;
