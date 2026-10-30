// IA_TRANSFER_REQUEST - Done: the read-back must show the write (CREATE / REPLACE: our new request, Requested, numbered, its lines and
// fingerprint; REFRESH: the new lines, fingerprint and revision; CANCEL: Cancelled; DEFECT: each reservation row and IA line at its
// target). CREATE / REPLACE link the IA to it (transfer_request_id / _no: display only - the request's source_ia_id is authoritative);
// a cancelled replacement links it back to the received request.
// Our claim is freed either way
const trDone = function trDone(g, dec, win, rows) {
  const s = iatrS;
  const back = trJ(rows) || {};
  const lot = back.lot || null;
  const want = dec.want || {};
  const created = g.op === "CREATE" || g.op === "REPLACE";
  const free = (ok) => ({ id: s(win.claimId) || "0", step_status: "FREE", finished_at: s(win.free && win.free.finished_at) || null,
    result_ref: ((ok ? "DONE|" : "UNCONFIRMED|") + g.key).slice(0, 250) });
  const noLink = { id: "0", transfer_request_id: "", transfer_request_no: "" };
  const unconfirmed = (view) => ({ code: "500", message: "The transfer request could not be confirmed after it was saved: open the Item Assembly again to see it.",
    result_json: JSON.stringify({ request: view }), link: noLink, needLink: "NO", free: free(false) });
  if (g.op === "DEFECT") {
    const holds = {};
    for (const h of Array.isArray(back.holds) ? back.holds : []) if (h && s(h.id)) holds[s(h.id)] = h;
    const lines = {};
    for (const l of Array.isArray(back.lines) ? back.lines : []) if (l && s(l.id)) lines[s(l.id)] = l;
    const ok = (want.holds || []).every((h) => holds[h.id] && s(holds[h.id].status) === h.status && iatrQ8(holds[h.id].open_qty) === iatrQ8(h.open_qty))
      && (want.lines || []).every((l) => lines[l.id] && iatrHash(s(lines[l.id].temp_qty_data)) === l.picks);
    if (!ok) return unconfirmed(null);
    return { code: "200", message: "Defect reported: moved to Blocked at the staging bin. Request a replacement for what is missing.",
      result_json: JSON.stringify({ defect: "YES", lines: (want.lines || []).length }), link: noLink, needLink: "NO", free: free(true) };
  }
  const lineRows = lot && Array.isArray(lot.lines) ? lot.lines : [];
  const sources = lineRows.map((l) => s(l.source_ia_line_id)).sort();
  const no = lot ? s(lot.no) : "";
  let ok = Boolean(lot) && s(lot.purpose) === IATR_PURPOSE && iatrId(lot.source) === iatrId(g.ia) && s(lot.status) === s(want.status) && (!want.lotId || s(lot.id) === s(want.lotId));
  if (ok && g.op !== "CANCEL") ok = s(lot.fp) === s(want.fp) && s(lot.rev) === s(want.rev) && JSON.stringify(sources) === JSON.stringify(want.sources || []);
  if (ok && created) ok = no !== "" && no !== "issued" && no !== "draft";
  const view = lot ? { id: s(lot.id), no: no, status: s(lot.status), rev: Number(lot.rev) || 0 } : null;
  if (!ok) return unconfirmed(view);
  const message = g.op === "CREATE" ? "Transfer request " + no + " created." : g.op === "REPLACE" ? "Replacement request " + no + " created."
    : g.op === "REFRESH" ? "Transfer request " + no + " refreshed from the Item Assembly's reservation." : "Transfer request " + no + " cancelled.";
  // CANCEL of a replacement: the link back to the received request (decide's relink)
  const link = created ? { id: g.ia, transfer_request_id: s(lot.id), transfer_request_no: no }
    : g.op === "CANCEL" && dec.relink && s(dec.relink.transfer_request_id) ? dec.relink : noLink;
  return { code: "200", message: message, result_json: JSON.stringify({ request: view, created: created ? "YES" : "NO" }),
    link: link, needLink: link === noLink ? "NO" : "YES", free: free(true) };
};
const res = trDone([{{node:code_node_TRguard.data}}][0], [{{node:code_node_TRdecide.data}}][0], [{{node:code_node_TRwin.data}}][0], [{{node:sql_node_TRback.data}}][0]);
console.log("request done", JSON.stringify({ code: res.code, message: res.message }));
return res;
