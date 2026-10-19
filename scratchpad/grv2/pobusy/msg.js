// PO busy: another Goods Receiving of the same purchase order is Processing (received in the background, its quantities not
// written yet) -> the message every refusing save / the conversion answers with
const poBusyMessage = function poBusyMessage(rows, convert) {
  const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();
  const seen = {};
  const parts = [];
  for (const r of Array.isArray(rows) ? rows : rows ? [rows] : []) {
    const po = str(r && (r.po_no || r.po_id));
    const gr = str(r && (r.gr_no || r.id));
    if (!po || seen[po + "|" + gr]) continue;
    seen[po + "|" + gr] = 1;
    parts.push({ po: po, gr: gr || "another Goods Receiving" });
  }
  if (!parts.length) return "";
  if (parts.length === 1) {
    return parts[0].po + " is still being received in the background by " + parts[0].gr + ". Please wait until it finishes, "
      + (convert ? "then convert it again." : "then try again.");
  }
  return "These purchase orders are still being received in the background: " + parts.slice(0, 5).map((p) => p.po + " (" + p.gr + ")").join(", ")
    + (parts.length > 5 ? " and " + (parts.length - 5) + " more" : "") + ". Please wait until they finish, " + (convert ? "then convert them again." : "then try again.");
};
